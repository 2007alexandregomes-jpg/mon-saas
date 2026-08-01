import path from "node:path";
import fs from "node:fs/promises";
import ffmpegPath from "ffmpeg-static";
import { run } from "./run";

/**
 * Plans fabriqués à partir d'une image fixe — sans modèle, sans coût.
 *
 * Tous les plans n'ont pas besoin d'être « édités » par une IA. Un gros plan
 * sur une matière, c'est un lent zoom sur une photo : sur une seconde, le
 * résultat est indiscernable d'un vrai plan macro, il est plus net, il est
 * instantané et il est gratuit.
 *
 * Le modèle d'édition vidéo reste réservé à ce qu'il est seul à savoir faire :
 * remplacer un vêtement porté par quelqu'un dans une scène réelle.
 */

export type StillShotOptions = {
  /** Durée du plan produit, en secondes. */
  durationSeconds: number;
  width: number;
  height: number;
  /**
   * Zone de la photo à cadrer, en fractions de 0 à 1.
   * Par défaut : l'image entière.
   */
  crop?: { x: number; y: number; width: number; height: number };
  /** `in` zoome vers le sujet, `out` s'en éloigne, `none` reste fixe. */
  zoom?: "in" | "out" | "none";
};

/**
 * Fabrique un plan à partir d'une photo, avec un lent mouvement de zoom.
 *
 * Le mouvement est indispensable : une image parfaitement figée au milieu d'un
 * montage se remarque immédiatement et casse le rythme.
 */
export async function stillShot(
  imagePath: string,
  outputPath: string,
  {
    durationSeconds,
    width,
    height,
    crop,
    zoom = "in",
  }: StillShotOptions,
): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const fps = 30;
  const frames = Math.max(1, Math.round(durationSeconds * fps));

  // On agrandit AVANT le zoom : `zoompan` travaille sur la grille de pixels de
  // son entrée, et sans cet agrandissement le mouvement avance par saccades
  // d'un pixel entier, très visibles.
  const superSample = 3;

  const cropFilter = crop
    ? `crop=in_w*${crop.width}:in_h*${crop.height}:in_w*${crop.x}:in_h*${crop.y},`
    : "";

  // 10 % d'amplitude : assez pour que ça vive, assez peu pour rester sobre.
  const zoomExpression =
    zoom === "in"
      ? `min(zoom+${(0.10 / frames).toFixed(6)},1.10)`
      : zoom === "out"
        ? `max(1.10-on*${(0.10 / frames).toFixed(6)},1.0)`
        : "1.0";

  await run(
    ffmpegPath,
    [
      "-loop",
      "1",
      "-i",
      imagePath,
      "-t",
      durationSeconds.toFixed(3),
      "-r",
      String(fps),
      "-vf",
      `${cropFilter}scale=${width * superSample}:-2,` +
        `zoompan=z='${zoomExpression}':d=${frames}:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps},` +
        `setsar=1,format=yuv420p`,
      "-c:v",
      "libx264",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ],
    { timeoutMs: 120_000 },
  );

  return outputPath;
}

/**
 * Fabrique un carton-titre : du texte centré sur fond uni.
 *
 * Le filtre `drawtext` n'est pas compilé dans le ffmpeg fourni par
 * ffmpeg-static. On passe donc par un sous-titre ASS incrusté : le format gère
 * la police, la taille, la couleur et le centrage, et le filtre `subtitles`,
 * lui, est bien présent.
 */
export async function titleCard(
  text: string,
  outputPath: string,
  {
    durationSeconds,
    width,
    height,
    background = "black",
    color = "FFFFFF",
    font = "Helvetica",
  }: {
    durationSeconds: number;
    width: number;
    height: number;
    background?: string;
    /** Couleur du texte en RRGGBB. */
    color?: string;
    font?: string;
  },
): Promise<string> {
  if (!ffmpegPath) throw new Error("ffmpeg introuvable.");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const fontSize = Math.round(Math.min(width, height) * 0.09);

  // ASS attend la couleur en &HAABBGGRR : ordre inversé, et un octet de
  // transparence en tête (00 = opaque).
  const [r, g, b] = [color.slice(0, 2), color.slice(2, 4), color.slice(4, 6)];
  const assColor = `&H00${b}${g}${r}`;

  const seconds = (n: number) => {
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = (n % 60).toFixed(2).padStart(5, "0");
    return `${h}:${String(m).padStart(2, "0")}:${s}`;
  };

  // `\N` est le retour à la ligne d'ASS ; les accolades y sont des balises.
  const assText = text
    .replace(/[{}]/g, "")
    .split(/\r?\n/)
    .join("\\N");

  const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Titre,${font},${fontSize},${assColor},${assColor},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${seconds(durationSeconds + 1)},Titre,,0,0,0,,${assText}
`;

  const assFile = `${outputPath}.ass`;
  await fs.writeFile(assFile, ass, "utf8");

  try {
    await run(
      ffmpegPath,
      [
        "-f",
        "lavfi",
        "-i",
        `color=c=${background}:s=${width}x${height}:d=${durationSeconds.toFixed(3)}:r=30`,
        "-vf",
        `subtitles=${assFile}`,
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ],
      { timeoutMs: 60_000 },
    );
  } finally {
    await fs.rm(assFile, { force: true });
  }

  return outputPath;
}
