/**
 * Génère la vidéo finale à partir d'une analyse enregistrée.
 *
 *   npm run analyze  -- "<lien>" "<produit>" "<desc>" --save analyse.json
 *   npm run generate -- analyse.json --images photo1.jpg photo2.jpg [--model turbo]
 *                       [--audio musique.mp3]
 *
 * `--images` accepte des CHEMINS DE FICHIERS ou des URL. Les fichiers locaux
 * sont téléversés automatiquement — Higgsfield ne sait télécharger l'image de
 * départ que depuis une adresse publique.
 *
 * Chaque plan utilise la photo que l'analyse lui a assignée
 * (`sourceImageIndex`) ; si l'index dépasse la liste, on retombe sur la
 * première.
 *
 * ⚠️ Cette commande consomme des crédits Higgsfield : environ 6,5 par plan.
 */

import fs from "node:fs";
import path from "node:path";
import { generateVideo } from "../src/lib/pipeline/generate-video";
import { resolveImageUrls } from "../src/lib/higgsfield/upload";
import { prepareProductImage } from "../src/lib/video/prepare-image";
import { addSoundtrack } from "../src/lib/video/assemble";
import os from "node:os";
import type { ShotModel } from "../src/lib/higgsfield/generate-shot";

type SavedAnalysis = {
  video?: { width: number | null; height: number | null; title: string | null };
  analysis: {
    visualSignature: string;
    shots: {
      durationSeconds: number;
      description: string;
      motionPrompt: string;
      sourceImageIndex: number;
    }[];
  };
};

const args = process.argv.slice(2);

function flagValues(name: string): string[] {
  const at = args.indexOf(name);
  if (at === -1) return [];
  return args.slice(at + 1).filter((a) => !a.startsWith("--"));
}

const imageEntries = flagValues("--images");
const model = (flagValues("--model")[0] ?? "turbo") as ShotModel;
const outputArg = flagValues("--out")[0];
/** `--audio musique.mp3` : piste sonore ajoutée à la vidéo finale. */
const audioPath = flagValues("--audio")[0];

const firstFlag = args.findIndex((a) => a.startsWith("--"));
const analysisPath = (firstFlag === -1 ? args : args.slice(0, firstFlag))[0];

if (!analysisPath || imageEntries.length === 0) {
  console.error(
    "Usage : npm run generate -- analyse.json --images <photo.jpg|url> [...] [--model turbo|standard|lite] [--out video.mp4]",
  );
  process.exit(1);
}
if (!fs.existsSync(analysisPath)) {
  console.error(`❌ Fichier introuvable : ${analysisPath}`);
  process.exit(1);
}
if (audioPath && !fs.existsSync(audioPath)) {
  console.error(`❌ Fichier audio introuvable : ${audioPath}`);
  process.exit(1);
}

for (const entry of imageEntries) {
  if (!/^https?:\/\//i.test(entry) && !fs.existsSync(entry)) {
    console.error(`❌ Photo introuvable : ${entry}`);
    process.exit(1);
  }
}

const saved = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as SavedAnalysis;
const { visualSignature, shots } = saved.analysis;

/**
 * La pub générée doit reproduire les dimensions de la vidéo de référence :
 * référence verticale → pub verticale, référence paysage → pub paysage.
 */
const targetFormat =
  saved.video?.width && saved.video?.height
    ? { width: saved.video.width, height: saved.video.height }
    : undefined;

const outputPath = path.resolve(
  outputArg ?? path.join(process.env.HOME ?? ".", "Desktop", "pub-generee.mp4"),
);

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(5);

// Récapitulatif AVANT de dépenser quoi que ce soit.
console.log(`\n${"═".repeat(70)}`);
console.log(`${shots.length} plans · modèle « ${model} » · ${imageEntries.length} image(s)`);
console.log(
  targetFormat
    ? `Format cible : ${targetFormat.width}×${targetFormat.height} (celui de la référence, ${
        targetFormat.width > targetFormat.height ? "paysage" : "vertical"
      })`
    : "⚠️  Format de la référence inconnu — le format du premier clip sera utilisé",
);
console.log(`Coût estimé : ~${(shots.length * 6.5).toFixed(0)} crédits`);
console.log("═".repeat(70));
shots.forEach((s, i) => {
  const idx = s.sourceImageIndex < imageEntries.length ? s.sourceImageIndex : 0;
  console.log(`  Plan ${i + 1} — ${s.durationSeconds}s · image #${idx} · ${s.description.slice(0, 45)}…`);
});
console.log();

async function main() {
  // Higgsfield calque le format de la vidéo sur celui de l'image d'entrée :
  // des photos aux proportions différentes donneraient des clips impossibles
  // à monter ensemble. On les met toutes en 9:16 d'abord.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-prepare-"));
  const prepared: string[] = [];
  for (const entry of imageEntries) {
    if (/^https?:\/\//i.test(entry)) {
      prepared.push(entry);
      continue;
    }
    const p = await prepareProductImage(entry, workDir, targetFormat);
    console.log(
      `[${elapsed()}] 🖼 ${path.basename(entry)} ${p.originalWidth}×${p.originalHeight}` +
        (p.unchanged
          ? " (déjà au bon format)"
          : ` → ${p.outputWidth}×${p.outputHeight}, marges ${p.backgroundColor}`),
    );
    prepared.push(p.filePath);
  }

  // Les fichiers locaux sont téléversés ; les URL sont gardées telles quelles.
  const imageUrls = await resolveImageUrls(prepared, (file) =>
    console.log(`[${elapsed()}] ⬆ téléversement de ${path.basename(file)}…`),
  );

  const result = await generateVideo({
    visualSignature,
    model,
    targetFormat,
    shots: shots.map((s) => ({
      durationSeconds: s.durationSeconds,
      motionPrompt: s.motionPrompt,
      imageUrl:
        imageUrls[s.sourceImageIndex] ?? imageUrls[0],
    })),
    onEvent: (event) => {
      switch (event.type) {
        case "plans lancés":
          console.log(`[${elapsed()}] 🚀 ${event.count} plans lancés en parallèle`);
          break;
        case "plan terminé":
          console.log(
            `[${elapsed()}] ✓ plan ${event.index + 1} prêt (${(event.elapsedMs / 1000).toFixed(0)}s)`,
          );
          break;
        case "plan échoué":
          console.log(`[${elapsed()}] ✗ plan ${event.index + 1} : ${event.message}`);
          break;
        case "assemblage":
          console.log(`[${elapsed()}] 🎬 assemblage des clips…`);
          break;
      }
    },
  });

  if (audioPath) {
    console.log(`[${elapsed()}] 🔊 ajout de la piste ${path.basename(audioPath)}…`);
    const withSound = await addSoundtrack(
      result.outputPath,
      audioPath,
      result.outputPath.replace(/\.mp4$/, "-son.mp4"),
    );
    fs.copyFileSync(withSound.outputPath, outputPath);
  } else {
    fs.copyFileSync(result.outputPath, outputPath);
  }
  await result.cleanup();

  console.log(`\n${"═".repeat(70)}`);
  console.log(`✅ Vidéo prête : ${outputPath}`);
  console.log(
    `   ${result.durationSeconds.toFixed(1)} s · ${audioPath ? "avec son · " : "MUETTE · "}${result.shots.length}/${shots.length} plans · ` +
      `${((Date.now() - started) / 1000 / 60).toFixed(1)} min · ` +
      `~${(result.shots.length * 6.5).toFixed(0)} crédits`,
  );
}

main().catch((error) => {
  console.error(`\n❌ Échec après ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
