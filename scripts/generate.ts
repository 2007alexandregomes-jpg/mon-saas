/**
 * Génère la vidéo finale à partir d'une analyse enregistrée.
 *
 *   npm run analyze  -- "<lien>" "<produit>" "<desc>" --save analyse.json
 *   npm run generate -- analyse.json --images photo1.jpg photo2.jpg [--model turbo]
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
import type { ShotModel } from "../src/lib/higgsfield/generate-shot";

type SavedAnalysis = {
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

for (const entry of imageEntries) {
  if (!/^https?:\/\//i.test(entry) && !fs.existsSync(entry)) {
    console.error(`❌ Photo introuvable : ${entry}`);
    process.exit(1);
  }
}

const saved = JSON.parse(fs.readFileSync(analysisPath, "utf8")) as SavedAnalysis;
const { visualSignature, shots } = saved.analysis;

const outputPath = path.resolve(
  outputArg ?? path.join(process.env.HOME ?? ".", "Desktop", "pub-generee.mp4"),
);

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(5);

// Récapitulatif AVANT de dépenser quoi que ce soit.
console.log(`\n${"═".repeat(70)}`);
console.log(`${shots.length} plans · modèle « ${model} » · ${imageEntries.length} image(s)`);
console.log(`Coût estimé : ~${(shots.length * 6.5).toFixed(0)} crédits`);
console.log("═".repeat(70));
shots.forEach((s, i) => {
  const idx = s.sourceImageIndex < imageEntries.length ? s.sourceImageIndex : 0;
  console.log(`  Plan ${i + 1} — ${s.durationSeconds}s · image #${idx} · ${s.description.slice(0, 45)}…`);
});
console.log();

async function main() {
  // Les fichiers locaux sont téléversés ; les URL sont gardées telles quelles.
  const imageUrls = await resolveImageUrls(imageEntries, (file) =>
    console.log(`[${elapsed()}] ⬆ téléversement de ${path.basename(file)}…`),
  );

  const result = await generateVideo({
    visualSignature,
    model,
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

  fs.copyFileSync(result.outputPath, outputPath);
  await result.cleanup();

  console.log(`\n${"═".repeat(70)}`);
  console.log(`✅ Vidéo prête : ${outputPath}`);
  console.log(
    `   ${result.durationSeconds.toFixed(1)} s · ${result.shots.length}/${shots.length} plans · ` +
      `${((Date.now() - started) / 1000 / 60).toFixed(1)} min · ` +
      `~${(result.shots.length * 6.5).toFixed(0)} crédits`,
  );
}

main().catch((error) => {
  console.error(`\n❌ Échec après ${((Date.now() - started) / 1000).toFixed(0)} s`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
