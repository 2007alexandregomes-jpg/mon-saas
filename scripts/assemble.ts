/**
 * Réassemble une vidéo à partir de clips déjà générés.
 *
 *   npm run assemble -- <dossier-des-clips> analyse.json [--out video.mp4]
 *
 * À utiliser quand la génération a réussi mais que l'assemblage a échoué : les
 * clips ont coûté des crédits, il serait absurde de les regénérer. Cette
 * commande est gratuite et se relance autant de fois qu'on veut.
 */

import fs from "node:fs";
import path from "node:path";
import { assembleVideo, probeDuration, probeVideoStream } from "../src/lib/video/assemble";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outputArg = outFlag === -1 ? undefined : args[outFlag + 1];
const positional = args.filter((a) => !a.startsWith("--") && a !== outputArg);
const [clipsDir, analysisPath] = positional;

if (!clipsDir) {
  console.error(
    "Usage : npm run assemble -- <dossier-des-clips> [analyse.json] [--out video.mp4]",
  );
  process.exit(1);
}
if (!fs.existsSync(clipsDir)) {
  console.error(`❌ Dossier introuvable : ${clipsDir}`);
  process.exit(1);
}

// Les clips sont nommés shot-00.mp4, shot-01.mp4… : l'ordre alphabétique est
// donc l'ordre du montage.
const clips = fs
  .readdirSync(clipsDir)
  .filter((f) => f.startsWith("shot-") && f.endsWith(".mp4"))
  .sort()
  .map((f) => path.join(clipsDir, f));

if (clips.length === 0) {
  console.error(`❌ Aucun clip « shot-*.mp4 » dans ${clipsDir}`);
  process.exit(1);
}

/** Les durées viennent de l'analyse si elle est fournie, sinon clip entier. */
let durations: (number | undefined)[] = clips.map(() => undefined);
/** Le format de la référence, que la pub doit reproduire. */
let targetFormat: { width: number; height: number } | undefined;

if (analysisPath && fs.existsSync(analysisPath)) {
  const saved = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as {
    video?: { width: number | null; height: number | null };
    analysis: { shots: { durationSeconds: number }[] };
  };
  durations = saved.analysis.shots.map((s) => s.durationSeconds);
  if (saved.video?.width && saved.video?.height) {
    targetFormat = { width: saved.video.width, height: saved.video.height };
  }
}

const outputPath = path.resolve(
  outputArg ?? path.join(process.env.HOME ?? ".", "Desktop", "pub-assemblee.mp4"),
);

async function main() {
  console.log(`\n${clips.length} clips trouvés dans ${clipsDir}\n`);
  for (const [i, clip] of clips.entries()) {
    const { width, height } = await probeVideoStream(clip);
    const d = await probeDuration(clip);
    const wanted = durations[i];
    console.log(
      `  ${path.basename(clip)} — ${width}×${height}, ${d.toFixed(2)}s` +
        (wanted ? ` → coupé à ${wanted}s` : ""),
    );
  }

  console.log(
    targetFormat
      ? `\n🎬 assemblage en ${targetFormat.width}×${targetFormat.height} (format de la référence)…`
      : "\n🎬 assemblage (format du premier clip)…",
  );
  const result = await assembleVideo(
    clips.map((filePath, i) => ({ filePath, durationSeconds: durations[i] })),
    outputPath,
    targetFormat,
  );

  console.log(`\n✅ ${result.outputPath}`);
  console.log(
    `   ${result.durationSeconds.toFixed(1)} s · ${result.width}×${result.height} · ${clips.length} plans`,
  );
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
