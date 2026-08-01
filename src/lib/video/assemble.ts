import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "./run";

/**
 * Recolle les clips générés en une seule vidéo.
 *
 * Higgsfield rend toujours 5,37 s ; un plan en demande souvent moins. On coupe
 * donc chaque clip à la durée voulue avant de les enchaîner.
 */

export type ClipToAssemble = {
  filePath: string;
  /** Durée voulue pour ce plan. Omise ou trop longue → le clip entier. */
  durationSeconds?: number;
};

/** Dimensions et cadence réelles d'un fichier vidéo. */
export async function probeVideoStream(filePath: string): Promise<{
  width: number;
  height: number;
}> {
  const { stdout } = await run(
    ffprobe.path,
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      filePath,
    ],
    { timeoutMs: 30_000 },
  );
  const [width, height] = stdout.trim().split(",").map(Number);
  return { width: width || 0, height: height || 0 };
}

/** Durée réelle d'un fichier vidéo, en secondes. */
export async function probeDuration(filePath: string): Promise<number> {
  const { stdout } = await run(
    ffprobe.path,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ],
    { timeoutMs: 30_000 },
  );
  const value = Number.parseFloat(stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

/**
 * Assemble les clips dans l'ordre donné.
 *
 * On ré-encode plutôt que de copier les flux tels quels : c'est le seul moyen
 * fiable de couper à une durée arbitraire (une copie ne peut trancher que sur
 * une image-clé, ce qui décalerait les coupes de plusieurs dixièmes).
 */
export async function assembleVideo(
  clips: ClipToAssemble[],
  outputPath: string,
  /**
   * Format de la vidéo finale. Omis, on reprend celui du premier clip — mais
   * l'appelant devrait toujours l'imposer : la publicité doit reproduire les
   * dimensions de la vidéo de référence.
   */
  targetFormat?: { width: number; height: number },
): Promise<{ outputPath: string; durationSeconds: number; width: number; height: number }> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg est introuvable (paquet ffmpeg-static absent ?).");
  }
  if (clips.length === 0) {
    throw new Error("Aucun clip à assembler.");
  }

  // Une durée demandée plus longue que le clip produirait une image figée en
  // fin de plan : on plafonne à ce qui existe réellement.
  const segments = await Promise.all(
    clips.map(async (clip) => {
      const available = await probeDuration(clip.filePath);
      const { width, height } = await probeVideoStream(clip.filePath);
      const wanted = clip.durationSeconds ?? available;
      return {
        filePath: clip.filePath,
        duration: Math.min(wanted, available),
        width,
        height,
      };
    }),
  );

  const empty = segments.filter((s) => s.duration <= 0 || s.width === 0);
  if (empty.length > 0) {
    throw new Error(
      `Clip(s) illisible(s) ou vide(s) : ${empty.map((s) => path.basename(s.filePath)).join(", ")}`,
    );
  }

  // `concat` exige des entrées strictement identiques : mêmes dimensions,
  // même cadence, mêmes pixels carrés. Higgsfield calque le format de sortie
  // sur celui de l'image d'entrée, donc rien ne garantit l'uniformité — on
  // aligne tout sur le format cible plutôt que d'échouer à l'assemblage,
  // après avoir déjà payé la génération.
  //
  // Les dimensions doivent être paires : libx264 en yuv420p les exige.
  const even = (n: number) => (n % 2 === 0 ? n : n - 1);
  const width = even(targetFormat?.width ?? segments[0].width);
  const height = even(targetFormat?.height ?? segments[0].height);

  const inputs = segments.flatMap((s) => ["-i", s.filePath]);

  // Pour chaque entrée : couper à la bonne durée, remettre l'horodatage à zéro
  // (`setpts` — sans ça le second clip commencerait à 5 s et ffmpeg insérerait
  // un blanc), puis normaliser format, cadence et rapport de pixels.
  const targetRatio = width / height;

  const filters = segments
    .map((s, i) => {
      const clipRatio = s.width / s.height;
      const drift = Math.abs(clipRatio - targetRatio) / targetRatio;

      // Higgsfield rend souvent des dimensions voisines mais pas identiques
      // (1280×704 pour une cible 1282×720). Ajouter des bandes noires pour
      // 2 % d'écart serait pire que le mal : on rogne un filet, invisible,
      // plutôt que d'encadrer l'image. Au-delà, le recadrage couperait le
      // produit — on préfère alors les bandes.
      const fit =
        drift < 0.05
          ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
          : `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;

      return (
        `[${i}:v]trim=start=0:end=${s.duration.toFixed(3)},setpts=PTS-STARTPTS,` +
        `${fit},setsar=1,fps=30,format=yuv420p[v${i}]`
      );
    })
    .join(";");

  const concatInputs = segments.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${filters};${concatInputs}concat=n=${segments.length}:v=1:a=0[out]`;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await run(
    ffmpegPath,
    [
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18", // quasi sans perte : la vidéo sera peut-être ré-encodée par TikTok
      "-pix_fmt",
      "yuv420p", // indispensable pour la lecture sur mobile et sur le web
      "-movflags",
      "+faststart", // la lecture démarre sans attendre le téléchargement complet
      "-y",
      outputPath,
    ],
    { timeoutMs: 300_000 },
  );

  return {
    outputPath,
    durationSeconds: segments.reduce((total, s) => total + s.duration, 0),
    width,
    height,
  };
}

/** Télécharge un clip généré vers un fichier local. */
export async function downloadClip(
  url: string,
  destination: string,
): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`Téléchargement du clip impossible (HTTP ${response.status}).`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
  return destination;
}
