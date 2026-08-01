import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { run } from "./run";

/**
 * Met les photos produit au format voulu AVANT de les envoyer à Higgsfield.
 *
 * Pourquoi c'est indispensable : Higgsfield calque le format de la vidéo sur
 * celui de l'image d'entrée. Cinq photos aux proportions différentes donnent
 * donc cinq clips de dimensions différentes, impossibles à monter ensemble.
 *
 * Le format cible est celui de la VIDÉO DE RÉFÉRENCE : une pub verticale se
 * copie en vertical, une pub paysage en paysage.
 *
 * On complète donc chaque photo avec des marges de la couleur de son propre
 * fond, plutôt que de la recadrer : recadrer une photo produit couperait le
 * produit.
 */

/** Repli quand le format de la référence est inconnu : 9:16, celui de TikTok. */
export const VERTICAL_9_16 = { width: 1080, height: 1920 } as const;

export type ImageFormat = { width: number; height: number };

/**
 * Devine la couleur de fond en échantillonnant les quatre coins.
 *
 * Sur un packshot e-commerce, les coins sont le fond. On prend la médiane pour
 * qu'un coin atypique (une ombre, un reflet) ne fausse pas le résultat.
 */
async function detectBackgroundColor(filePath: string): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");

  // On réduit l'image à 3×3 pixels : chaque pixel résume une zone entière.
  const { stdout } = await run(
    ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      filePath,
      "-vf",
      "scale=3:3",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { timeoutMs: 30_000 },
  );

  const bytes = Buffer.from(stdout, "binary");
  if (bytes.length < 27) return "white";

  // Les quatre coins de la grille 3×3 : indices 0, 2, 6 et 8.
  const corners = [0, 2, 6, 8].map((i) => ({
    r: bytes[i * 3],
    g: bytes[i * 3 + 1],
    b: bytes[i * 3 + 2],
  }));

  const median = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

  const r = median(corners.map((c) => c.r));
  const g = median(corners.map((c) => c.g));
  const b = median(corners.map((c) => c.b));

  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return `0x${hex(r)}${hex(g)}${hex(b)}`;
}

export type PreparedImage = {
  filePath: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  backgroundColor: string;
  /** Vrai si l'image avait déjà les bonnes proportions. */
  unchanged: boolean;
};

/**
 * Complète une photo aux proportions voulues, sans jamais rogner le produit.
 */
export async function prepareProductImage(
  inputPath: string,
  outputDir: string,
  format: ImageFormat = VERTICAL_9_16,
): Promise<PreparedImage> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");

  const { stdout: dimensions } = await run(
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
      inputPath,
    ],
    { timeoutMs: 30_000 },
  );
  const [originalWidth, originalHeight] = dimensions.trim().split(",").map(Number);

  const backgroundColor = await detectBackgroundColor(inputPath);

  // Les encodeurs vidéo exigent des dimensions paires.
  const even = (n: number) => (n % 2 === 0 ? n : n - 1);
  format = { width: even(format.width), height: even(format.height) };

  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `${path.basename(inputPath, path.extname(inputPath))}-${format.width}x${format.height}.png`,
  );

  await run(
    ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      inputPath,
      "-vf",
      // `decrease` : l'image entre entièrement dans le cadre, on ne rogne rien.
      `scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,` +
        `pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2:${backgroundColor}`,
      "-y",
      outputPath,
    ],
    { timeoutMs: 60_000 },
  );

  const ratio = originalWidth / originalHeight;
  const target = format.width / format.height;

  return {
    filePath: outputPath,
    originalWidth,
    originalHeight,
    outputWidth: format.width,
    outputHeight: format.height,
    backgroundColor,
    unchanged: Math.abs(ratio - target) < 0.01,
  };
}
