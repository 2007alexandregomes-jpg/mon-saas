/**
 * Test du pipeline en ligne de commande, sans passer par l'interface web.
 *
 *   npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"] [--voix-off]
 *
 * Par défaut, l'annonce générée reproduit la forme de la référence : muette si
 * la référence est muette. `--voix-off` force l'ajout d'un script parlé.
 *
 * `--photos` accepte des chemins de fichiers : Claude voit alors le vrai produit
 * et désigne, pour chaque plan, la photo la plus proche du cadrage voulu.
 */

import fs from "node:fs";
import { analyzeCompetitorVideo } from "../src/lib/pipeline/analyze-competitor-video";

const args = process.argv.slice(2);
const forceVoiceover = args.includes("--voix-off");

/** `--photos a.jpg b.jpg` : les chemins des photos produit, séparés par des espaces. */
const photosFlag = args.indexOf("--photos");
const photoPaths =
  photosFlag === -1
    ? []
    : args.slice(photosFlag + 1).filter((a) => !a.startsWith("--"));

const positional = (
  photosFlag === -1 ? args : args.slice(0, photosFlag)
).filter((a) => !a.startsWith("--"));
const [url, productName, productDescription] = positional;

if (!url || !productName) {
  console.error(
    'Usage : npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"] [--voix-off] [--photos photo1.jpg photo2.jpg]',
  );
  process.exit(1);
}

const productImages = photoPaths.map((p) => {
  if (!fs.existsSync(p)) {
    console.error(`❌ Photo introuvable : ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p).toString("base64");
});

if (productImages.length > 0) {
  console.log(`📷 ${productImages.length} photo(s) produit chargée(s)\n`);
}

const started = Date.now();
const rule = "─".repeat(70);

/** Secondes écoulées depuis le lancement, pour voir où le temps passe. */
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`.padStart(6);

async function main() {
  const result = await analyzeCompetitorVideo({
    url,
    product: {
      name: productName,
      description: productDescription ?? null,
      images: productImages,
    },
    options: { forceVoiceover },

    // Chaque résultat est affiché dès qu'il existe, sans attendre la fin.
    onEvent: (event) => {
      if (event.status === "start") {
        console.log(`[${elapsed()}] ⏳ ${event.step}…`);
        return;
      }

      switch (event.step) {
        case "téléchargement":
          console.log(
            `[${elapsed()}] ✓ « ${event.video.title?.slice(0, 55) ?? "sans titre"} » — ${event.video.durationSeconds ?? "?"} s, @${event.video.uploader ?? "?"}`,
          );
          break;
        case "texte parlé":
          console.log(
            `[${elapsed()}] ✓ ${event.source}${
              event.transcript
                ? ` — « ${event.transcript.slice(0, 60).replace(/\s+/g, " ")}… »`
                : ""
            }`,
          );
          break;
        case "images":
          console.log(`[${elapsed()}] ✓ ${event.count} images extraites`);
          break;
        case "analyse":
          console.log(`[${elapsed()}] ✓ analyse terminée`);
          break;
      }
    },
  });

  const { analysis, usage } = result;
  const fmt = analysis.referenceFormat;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`VIDÉO : ${result.video.title ?? "(sans titre)"}`);
  console.log(
    `${result.video.durationSeconds ?? "?"} s · ${result.frameCount} images · texte parlé : ${result.transcriptSource}`,
  );

  console.log(`\n${rule}\nFORME DE LA RÉFÉRENCE`);
  console.log(`  Quelqu'un parle    : ${fmt.hasSpokenScript ? "OUI" : "NON"}`);
  console.log(`  Texte à l'écran    : ${fmt.hasOnScreenText ? "OUI" : "NON"}`);
  console.log(`  ${fmt.summary}`);
  console.log(
    `  → Adaptation : ${
      forceVoiceover
        ? "VOIX OFF FORCÉE (demandée explicitement)"
        : "même forme que la référence"
    }`,
  );

  console.log(`\n${rule}\nSTYLE VISUEL`);
  console.log(`  Caméra    : ${analysis.style.camera}`);
  console.log(`  Lumière   : ${analysis.style.lighting}`);
  console.log(`  Rythme    : ${analysis.style.pacing}`);
  console.log(`  Décor     : ${analysis.style.setting}`);

  console.log(`\n${rule}\nSTRUCTURE D'ORIGINE`);
  console.log(`  Accroche  : ${analysis.originalScript.hook}`);
  console.log(`  Corps     : ${analysis.originalScript.body}`);
  console.log(`  Conclusion: ${analysis.originalScript.cta}`);

  console.log(`\n${rule}\nADAPTÉ POUR « ${productName} »`);
  console.log(`  Accroche  : ${analysis.adaptedScript.hook}`);
  console.log(`  Corps     : ${analysis.adaptedScript.body}`);
  console.log(`  Conclusion: ${analysis.adaptedScript.cta}`);

  const total = analysis.shots.reduce((s, shot) => s + shot.durationSeconds, 0);
  console.log(
    `\n${rule}\nDÉCOUPAGE POUR HIGGSFIELD — ${analysis.shots.length} plans, ${total} s au total`,
  );
  console.log(`\n  Signature visuelle (commune à tous les plans) :`);
  console.log(`  ${analysis.visualSignature}`);

  analysis.shots.forEach((shot, i) => {
    console.log(`\n  ${"·".repeat(66)}`);
    console.log(`  PLAN ${i + 1} — ${shot.durationSeconds} s`);
    console.log(`  ${shot.description}`);
    console.log(
      `\n    Photo de départ : #${shot.sourceImageIndex}${
        photoPaths[shot.sourceImageIndex]
          ? ` (${photoPaths[shot.sourceImageIndex]})`
          : " (aucune photo fournie)"
      }`,
    );
    console.log(`    Image voulue    : ${shot.referenceImage}`);
    console.log(`    Mouvement       : ${shot.motionPrompt}`);
  });

  console.log(`\n${rule}\nNOTES`);
  console.log(`  ${analysis.notes}`);

  console.log(`\n${"═".repeat(70)}`);
  console.log(
    `✅ Terminé en ${((Date.now() - started) / 1000).toFixed(1)} s · ` +
      `${usage.inputTokens.toLocaleString("fr-FR")} tokens entrée + ` +
      `${usage.outputTokens.toLocaleString("fr-FR")} sortie · ` +
      `coût ≈ ${usage.costUsd.toFixed(3)} $`,
  );
}

main().catch((error) => {
  console.error(`\n❌ Échec après ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
