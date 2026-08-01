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
): Promise<{ outputPath: string; durationSeconds: number }> {
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
      const wanted = clip.durationSeconds ?? available;
      return { filePath: clip.filePath, duration: Math.min(wanted, available) };
    }),
  );

  const inputs = segments.flatMap((s) => ["-i", s.filePath]);

  // Pour chaque entrée : couper à la bonne durée, puis remettre l'horodatage à
  // zéro (`setpts`) — sans ça, le second clip commencerait à 5 s et ffmpeg
  // insérerait un blanc.
  const filters = segments
    .map(
      (s, i) =>
        `[${i}:v]trim=start=0:end=${s.duration.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
    )
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
