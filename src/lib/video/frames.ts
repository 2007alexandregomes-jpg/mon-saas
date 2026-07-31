import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { run } from "./run";

/**
 * Extrait des images réparties régulièrement dans la vidéo.
 *
 * Pourquoi des images fixes plutôt que la vidéo entière : Claude analyse des
 * images. Six instantanés bien répartis suffisent à décrire le cadrage, les
 * mouvements de caméra, l'éclairage et le texte incrusté à l'écran.
 */
export async function extractFrames(
  videoPath: string,
  {
    count = 6,
    durationSeconds,
  }: { count?: number; durationSeconds: number | null },
): Promise<string[]> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg est introuvable (paquet ffmpeg-static absent ?).");
  }

  const outputDir = path.join(path.dirname(videoPath), "frames");
  await fs.mkdir(outputDir, { recursive: true });

  // Sans durée connue, on retombe sur « une image toutes les 2 secondes ».
  const filter =
    durationSeconds && durationSeconds > 0
      ? `fps=${count / durationSeconds}`
      : "fps=0.5";

  await run(
    ffmpegPath,
    [
      "-i",
      videoPath,
      "-vf",
      `${filter},scale=768:-2`, // 768 px de large : assez pour Claude, léger à envoyer
      "-frames:v",
      String(count),
      "-q:v",
      "3",
      path.join(outputDir, "frame-%02d.jpg"),
    ],
    { timeoutMs: 120_000 },
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
