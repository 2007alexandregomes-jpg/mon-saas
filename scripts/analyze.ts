/**
 * Test du pipeline en ligne de commande, sans passer par l'interface web.
 *
 *   npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"]
 *
 * Exemple :
 *   npm run analyze -- "https://www.tiktok.com/@x/video/123" "Crème hydratante bio"
 */

import { analyzeCompetitorVideo } from "../src/lib/pipeline/analyze-competitor-video";

const [url, productName, productDescription] = process.argv.slice(2);

if (!url || !productName) {
  console.error(
    'Usage : npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"]',
  );
  process.exit(1);
}

const started = Date.now();

async function main() {
  const result = await analyzeCompetitorVideo({
    url,
    product: { name: productName, description: productDescription ?? null },
    onProgress: (step) => console.log(`⏳ ${step}…`),
  });

  const { analysis } = result;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`VIDÉO : ${result.video.title ?? "(sans titre)"}`);
  console.log(
    `${result.video.durationSeconds ?? "?"} s · ${result.frameCount} images · texte parlé : ${result.transcriptSource}`,
  );

  console.log(`\n${"─".repeat(70)}\nSTYLE VISUEL`);
  console.log(`  Caméra    : ${analysis.style.camera}`);
  console.log(`  Lumière   : ${analysis.style.lighting}`);
  console.log(`  Rythme    : ${analysis.style.pacing}`);
  console.log(`  Décor     : ${analysis.style.setting}`);

  console.log(`\n${"─".repeat(70)}\nSCRIPT D'ORIGINE`);
  console.log(`  Accroche  : ${analysis.originalScript.hook}`);
  console.log(`  Corps     : ${analysis.originalScript.body}`);
  console.log(`  Conclusion: ${analysis.originalScript.cta}`);

  console.log(`\n${"─".repeat(70)}\nSCRIPT RÉÉCRIT POUR « ${productName} »`);
  console.log(`  Accroche  : ${analysis.adaptedScript.hook}`);
  console.log(`  Corps     : ${analysis.adaptedScript.body}`);
  console.log(`  Conclusion: ${analysis.adaptedScript.cta}`);

  console.log(`\n${"─".repeat(70)}\nPROMPT HIGGSFIELD`);
  console.log(`  ${analysis.higgsfieldPrompt}`);

  console.log(`\n${"─".repeat(70)}\nNOTES`);
  console.log(`  ${analysis.notes}`);

  console.log(
    `\n${"═".repeat(70)}\n✅ Terminé en ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}

main().catch((error) => {
  console.error(`\n❌ Échec après ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
