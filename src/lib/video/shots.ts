import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { run } from "./run";
import { probeDuration } from "./assemble";

/**
 * Découpage d'une vidéo en plans.
 *
 * Une publicité courte enchaîne les coupes — souvent une par seconde. Le modèle
 * d'édition vidéo, lui, régénère un segment comme UNE scène continue : lui
 * donner 6 secondes contenant 5 coupes rend 6 secondes d'un seul tenant, et le
 * montage disparaît.
 *
 * On découpe donc à chaque coupe, on traite chaque plan séparément, et on
 * recolle. Le rythme d'origine est préservé à l'image près.
 */

/**
 * Sensibilité de la détection.
 *
 * `scene` vaut de 0 à 1 selon l'écart entre deux images consécutives. 0,2 est
 * le réglage qui, sur les publicités testées, retrouve exactement les coupes
 * visibles sans en inventer sur un simple mouvement de caméra.
 */
const SCENE_THRESHOLD = 0.2;

/** En dessous, ce n'est pas un plan mais un artefact de compression. */
const MIN_SHOT_SECONDS = 0.25;

export type Shot = {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  /** Rempli par `splitShots`. */
  filePath?: string;
};

/**
 * Repère les coupes et en déduit les plans.
 *
 * On n'extrait rien ici : c'est une simple lecture, quasi instantanée.
 */
export async function detectShots(videoPath: string): Promise<Shot[]> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");

  const total = await probeDuration(videoPath);

  // `showinfo` écrit sur stderr une ligne par image retenue par `select`.
  const { stderr } = await run(
    ffmpegPath,
    [
      "-v",
      "info",
      "-i",
      videoPath,
      "-vf",
      `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 180_000 },
  );

  const cuts = [
    ...new Set(
      [...stderr.matchAll(/pts_time:([0-9.]+)/g)]
        .map((m) => Number.parseFloat(m[1]))
        .filter((t) => Number.isFinite(t) && t > 0 && t < total),
    ),
  ].sort((a, b) => a - b);

  // Les bornes des plans : début, chaque coupe, fin.
  const bounds = [0, ...cuts, total];

  const shots: Shot[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startSeconds = bounds[i];
    const durationSeconds = bounds[i + 1] - startSeconds;
    // Une coupe détectée deux fois de suite produirait un plan de durée nulle.
    if (durationSeconds < MIN_SHOT_SECONDS) continue;
    shots.push({ index: shots.length, startSeconds, durationSeconds });
  }

  return shots;
}

/**
 * Extrait chaque plan dans son propre fichier.
 *
 * On ré-encode : une copie de flux ne peut trancher que sur une image-clé, ce
 * qui décalerait les coupes de plusieurs dixièmes de seconde.
 */
export async function splitShots(
  videoPath: string,
  shots: Shot[],
  outputDir: string,
): Promise<Shot[]> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");
  // Capturé dans une constante : TypeScript ne propage pas le rétrécissement
  // de type à l'intérieur de la closure du `map`.
  const ffmpeg = ffmpegPath;
  await fs.mkdir(outputDir, { recursive: true });

  return Promise.all(
    shots.map(async (shot) => {
      const filePath = path.join(
        outputDir,
        `plan-${String(shot.index).padStart(2, "0")}.mp4`,
      );

      await run(
        ffmpeg,
        [
          "-ss",
          shot.startSeconds.toFixed(3),
          "-t",
          shot.durationSeconds.toFixed(3),
          "-i",
          videoPath,
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-an", // le son reste sur la vidéo d'origine, on le remettra au montage
          "-y",
          filePath,
        ],
        { timeoutMs: 120_000 },
      );

      return { ...shot, filePath };
    }),
  );
}

/** Extrait quelques images d'un plan, pour que Claude puisse le regarder. */
export async function extractShotFrames(
  shotPath: string,
  outputDir: string,
  count = 3,
): Promise<string[]> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");
  await fs.mkdir(outputDir, { recursive: true });

  const duration = await probeDuration(shotPath);
  const base = path.basename(shotPath, ".mp4");
  const paths: string[] = [];

  for (let i = 0; i < count; i++) {
    // Réparties dans le plan, en évitant la toute première image (souvent
    // encore en fondu depuis la coupe précédente).
    const at = duration * ((i + 0.5) / count);
    const filePath = path.join(outputDir, `${base}-f${i}.jpg`);

    await run(
      ffmpegPath,
      [
        "-ss",
        at.toFixed(3),
        "-i",
        shotPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=512:-2",
        "-q:v",
        "4",
        "-y",
        filePath,
      ],
      { timeoutMs: 60_000 },
    );
    paths.push(filePath);
  }

  return paths;
}
