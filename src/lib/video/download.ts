import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { run, ProcessError } from "./run";

/** Binaire autonome téléchargé dans bin/ (voir README). */
const YT_DLP = path.join(process.cwd(), "bin", "yt-dlp");

/** Au-delà, on refuse : une pub fait 15-60 s, pas un long-métrage. */
const MAX_DURATION_SECONDS = 180;

export type VideoInfo = {
  /** Chemin du fichier téléchargé, dans un dossier temporaire. */
  filePath: string;
  title: string | null;
  description: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  /**
   * Dimensions ORIGINALES de la vidéo de référence.
   *
   * C'est le format que la publicité générée devra reproduire. On les lit dans
   * les métadonnées et non sur le fichier téléchargé : on télécharge une copie
   * allégée, dont les dimensions ne sont pas celles de l'original.
   */
  width: number | null;
  height: number | null;
  /**
   * Le texte parlé, si la plateforme fournit des sous-titres (automatiques ou
   * non). `null` quand il n'y en a pas — il faudra alors transcrire l'audio.
   */
  subtitles: string | null;
};

/**
 * Convertit un fichier WebVTT en texte suivi.
 *
 * Un .vtt alterne horodatages et répliques, et répète souvent la même ligne
 * d'un bloc à l'autre (effet machine à écrire des sous-titres automatiques).
 * On ne garde que le texte, sans les doublons consécutifs.
 */
function vttToText(vtt: string): string {
  const lines: string[] = [];

  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw
      .replace(/<[^>]+>/g, "") // balises de karaoké <00:00:01.000>
      .trim();

    if (!line) continue;
    if (line === "WEBVTT") continue;
    if (line.startsWith("NOTE") || line.startsWith("Kind:")) continue;
    if (line.startsWith("Language:")) continue;
    if (line.includes("-->")) continue; // ligne d'horodatage
    if (/^\d+$/.test(line)) continue; // numéro de bloc

    if (lines[lines.length - 1] !== line) lines.push(line);
  }

  return lines.join(" ").trim();
}

export class VideoDownloadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VideoDownloadError";
  }
}

/** N'accepte qu'une vraie adresse http(s) publique. */
function assertUsableUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VideoDownloadError("Ce n'est pas une adresse valide.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VideoDownloadError("Le lien doit commencer par http:// ou https://.");
  }
  // Empêche de faire pointer le téléchargeur vers le réseau interne du serveur.
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  ) {
    throw new VideoDownloadError("Ce lien n'est pas une vidéo publique.");
  }
}

/** Lit les métadonnées SANS télécharger la vidéo — rapide, et permet de refuser tôt. */
export async function probeVideo(url: string) {
  assertUsableUrl(url);

  let stdout: string;
  try {
    ({ stdout } = await run(
      YT_DLP,
      ["--dump-single-json", "--no-warnings", "--no-playlist", url],
      { timeoutMs: 60_000 },
    ));
  } catch (error) {
    const stderr = error instanceof ProcessError ? error.stderr : "";
    throw new VideoDownloadError(
      "Impossible de lire cette vidéo. Vérifie que le lien est public et toujours en ligne.",
      stderr,
    );
  }

  const meta = JSON.parse(stdout) as {
    title?: string;
    description?: string;
    duration?: number;
    uploader?: string;
    width?: number;
    height?: number;
  };

  const durationSeconds = meta.duration ?? null;
  if (durationSeconds !== null && durationSeconds > MAX_DURATION_SECONDS) {
    throw new VideoDownloadError(
      `Cette vidéo dure ${Math.round(durationSeconds)} s. La limite est de ${MAX_DURATION_SECONDS} s — colle une publicité courte.`,
    );
  }

  return {
    title: meta.title ?? null,
    description: meta.description ?? null,
    durationSeconds,
    uploader: meta.uploader ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}

/**
 * Télécharge la vidéo dans un dossier temporaire.
 *
 * L'appelant DOIT appeler `cleanup()` quand il a fini, sinon les fichiers
 * s'accumulent dans /tmp.
 */
export async function downloadVideo(
  url: string,
): Promise<VideoInfo & { cleanup: () => Promise<void> }> {
  const meta = await probeVideo(url);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-video-"));
  const outputTemplate = path.join(workDir, "source.%(ext)s");

  try {
    await run(
      YT_DLP,
      [
        // Le plus petit mp4 correct : on n'analyse que le mouvement et le
        // cadrage, la 4K ne servirait qu'à ralentir le téléchargement.
        "-f",
        "mp4[height<=720]/best[height<=720]/best",
        "--no-playlist",
        "--no-warnings",
        "--max-filesize",
        "200M",
        // Sous-titres : ceux de l'auteur ET ceux générés automatiquement.
        // C'est le texte parlé, gratuitement, quand la plateforme le fournit.
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "fr,fr-*,en,en-*",
        "--sub-format",
        "vtt/best",
        "-o",
        outputTemplate,
        url,
      ],
      { timeoutMs: 180_000 },
    );
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    const stderr = error instanceof ProcessError ? error.stderr : "";
    throw new VideoDownloadError(
      "Le téléchargement a échoué. La plateforme bloque peut-être la requête, ou la vidéo est privée.",
      stderr,
    );
  }

  const files = await fs.readdir(workDir);

  const downloaded = files.find(
    (f) => f.startsWith("source.") && !f.endsWith(".vtt"),
  );
  if (!downloaded) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw new VideoDownloadError("Aucun fichier vidéo n'a été récupéré.");
  }

  // Le français d'abord s'il existe, sinon n'importe quelle langue trouvée.
  const subtitleFile =
    files.find((f) => f.endsWith(".vtt") && f.includes(".fr")) ??
    files.find((f) => f.endsWith(".vtt"));

  let subtitles: string | null = null;
  if (subtitleFile) {
    const text = vttToText(await fs.readFile(path.join(workDir, subtitleFile), "utf8"));
    subtitles = text.length > 0 ? text : null;
  }

  return {
    ...meta,
    subtitles,
    filePath: path.join(workDir, downloaded),
    cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
  };
}
