import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { run } from "./run";

/** Images par seconde. 2 suffit à ne rater aucun changement de texte à l'écran. */
const FRAMES_PER_SECOND = 2;

/** Plafond de sécurité : au-delà, le coût d'analyse grimpe sans rien apporter. */
const MAX_FRAMES = 60;

/** Largeur des images envoyées à Claude. Assez pour lire un sous-titre TikTok. */
const FRAME_WIDTH = 512;

/**
 * Extrait des images tout au long de la vidéo.
 *
 * Pourquoi des images fixes : Claude analyse des images, pas des vidéos. À 2
 * images/seconde, on capture chaque plan, chaque coupe et surtout chaque
 * changement de texte incrusté — c'est là que se trouve une grosse partie du
 * script des publicités TikTok.
 */
export async function extractFrames(
  videoPath: string,
  { durationSeconds }: { durationSeconds: number | null },
): Promise<string[]> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg est introuvable (paquet ffmpeg-static absent ?).");
  }

  const outputDir = path.join(path.dirname(videoPath), "frames");
  await fs.mkdir(outputDir, { recursive: true });

  // Si la vidéo est longue, on baisse la cadence pour rester sous le plafond
  // plutôt que de tronquer et perdre toute la fin.
  const fps =
    durationSeconds && durationSeconds * FRAMES_PER_SECOND > MAX_FRAMES
      ? MAX_FRAMES / durationSeconds
      : FRAMES_PER_SECOND;

  await run(
    ffmpegPath,
    [
      "-i",
      videoPath,
      "-vf",
      `fps=${fps.toFixed(4)},scale=${FRAME_WIDTH}:-2`,
      "-frames:v",
      String(MAX_FRAMES),
      "-q:v",
      "4",
      path.join(outputDir, "frame-%03d.jpg"),
    ],
    { timeoutMs: 180_000 },
  );

  const files = (await fs.readdir(outputDir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();

  if (files.length === 0) {
    throw new Error("Aucune image n'a pu être extraite de la vidéo.");
  }

  return files.map((f) => path.join(outputDir, f));
}

/** Lit une image et la renvoie en base64, prête pour l'API Claude. */
export async function frameToBase64(framePath: string) {
  const buffer = await fs.readFile(framePath);
  return buffer.toString("base64");
}
