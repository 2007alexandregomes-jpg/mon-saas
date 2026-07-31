/**
 * Test du pipeline en ligne de commande, sans passer par l'interface web.
 *
 *   npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"] [--voix-off]
 *
 * Par défaut, l'annonce générée reproduit la forme de la référence : muette si
 * la référence est muette. `--voix-off` force l'ajout d'un script parlé.
 */

import { analyzeCompetitorVideo } from "../src/lib/pipeline/analyze-competitor-video";

const args = process.argv.slice(2);
const forceVoiceover = args.includes("--voix-off");
const [url, productName, productDescription] = args.filter(
  (a) => !a.startsWith("--"),
);

if (!url || !productName) {
  console.error(
    'Usage : npm run analyze -- "<lien vidéo>" "<nom du produit>" ["description"] [--voix-off]',
  );
  process.exit(1);
}

const started = Date.now();
const rule = "─".repeat(70);

async function main() {
  const result = await analyzeCompetitorVideo({
    url,
    product: { name: productName, description: productDescription ?? null },
    options: { forceVoiceover },
    onProgress: (step) => console.log(`⏳ ${step}…`),
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

  console.log(`\n${rule}\nPROMPT HIGGSFIELD`);
  console.log(`  ${analysis.higgsfieldPrompt}`);

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
