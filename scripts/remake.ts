/**
 * Refait une publicité existante avec le produit du client.
 *
 *   npm run remake -- "<lien>" "<produit>" "<description>" \
 *     --photos p1.jpg p2.jpg [--marque "Ma Marque"] [--garder-personnes] [--a-blanc]
 *
 * `--a-blanc` affiche le plan et le coût SANS rien dépenser. À utiliser avant
 * toute vraie exécution.
 */

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { remakeVideo } from "../src/lib/pipeline/remake-video";
import { getBalance } from "../src/lib/wavespeed/client";
import type { ImageMediaType } from "../src/lib/ai/analyze-video";

const args = process.argv.slice(2);
const dryRun = args.includes("--a-blanc");
const replacePeople = !args.includes("--garder-personnes");

/**
 * Les valeurs d'un drapeau, jusqu'au drapeau suivant.
 *
 * S'arrêter au drapeau suivant est essentiel : sinon `--photos a.jpg b.jpg
 * --marque "Ma Marque"` ferait avaler « Ma Marque » à la liste des photos.
 */
function flagValues(name: string): string[] {
  const at = args.indexOf(name);
  if (at === -1) return [];
  const values: string[] = [];
  for (const value of args.slice(at + 1)) {
    if (value.startsWith("--")) break;
    values.push(value);
  }
  return values;
}

const photoPaths = flagValues("--photos");
const brandText = flagValues("--marque")[0];

const firstFlag = args.findIndex((a) => a.startsWith("--"));
const [url, productName, productDescription] = (
  firstFlag === -1 ? args : args.slice(0, firstFlag)
).filter((a) => !a.startsWith("--"));

if (!url || !productName || photoPaths.length === 0) {
  console.error(
    'Usage : npm run remake -- "<lien>" "<produit>" ["description"] --photos p1.jpg [p2.jpg] ' +
      '[--marque "Ma Marque"] [--garder-personnes] [--a-blanc]',
  );
  process.exit(1);
}

for (const p of photoPaths) {
  if (!fs.existsSync(p)) {
    console.error(`❌ Photo introuvable : ${p}`);
    process.exit(1);
  }
}

/** Devine le format d'après les premiers octets, jamais d'après l'extension. */
function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  return "image/jpeg";
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** Rend un fichier local accessible publiquement, via Supabase Storage. */
async function uploadPublic(filePath: string, key: string): Promise<string> {
  const bucket = filePath.endsWith(".mp4") ? "generated-videos" : "product-images";
  const storagePath = `remake/${key}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fs.readFileSync(filePath), {
      contentType: filePath.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
      upsert: true,
    });
  if (error) throw new Error(`Téléversement impossible : ${error.message}`);
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(5);

const ETIQUETTES = {
  edit: "🎬 édition vidéo (payant)",
  still: "🔍 zoom sur photo (gratuit)",
  card: "🏷  carton de marque (gratuit)",
  drop: "🚫 retiré du montage",
} as const;

async function main() {
  console.log(`\nSolde WaveSpeed : ${(await getBalance()).toFixed(2)} $`);
  if (dryRun) console.log("MODE À BLANC — aucune dépense d'édition\n");

  const productImages = photoPaths.map((p) => {
    const buffer = fs.readFileSync(p);
    return { data: buffer.toString("base64"), mediaType: detectMediaType(buffer) };
  });

  const productImageUrls = dryRun
    ? []
    : await Promise.all(
        photoPaths.map((p, i) =>
          uploadPublic(p, `photo-${i}-${Date.now()}${path.extname(p)}`),
        ),
      );

  const result = await remakeVideo({
    url,
    product: { name: productName, description: productDescription ?? null },
    productImages,
    productImageUrls,
    productImagePaths: photoPaths,
    options: {
      replacePeople,
      brandCards: { mode: brandText ? "replace" : "drop", text: brandText },
    },
    uploadPublic,
    onEvent: (event) => {
      switch (event.type) {
        case "téléchargement":
          console.log(`[${elapsed()}] ⏳ téléchargement de la référence…`);
          break;
        case "découpage":
          console.log(`[${elapsed()}] ✓ ${event.shots} plans détectés`);
          break;
        case "analyse":
          console.log(`[${elapsed()}] ⏳ Claude examine chaque plan…`);
          break;
        case "plan prévu":
          console.log(
            `           plan ${event.index} · ${ETIQUETTES[event.treatment]}\n` +
              `             ${event.content}\n` +
              `             → ${event.reason}`,
          );
          break;
        case "plans lancés":
          console.log(
            `\n[${elapsed()}] 🚀 ${event.edits} édition(s) payante(s) + ${event.locaux} plan(s) local(aux)` +
              `\n           coût estimé : ${event.coutEstime.toFixed(2)} $\n`,
          );
          if (dryRun) {
            console.log("MODE À BLANC — arrêt avant dépense.");
            process.exit(0);
          }
          break;
        case "plan terminé":
          console.log(`[${elapsed()}] ✓ plan ${event.index} prêt`);
          break;
        case "plan échoué":
          console.log(`[${elapsed()}] ✗ plan ${event.index} : ${event.message}`);
          break;
        case "assemblage":
          console.log(`[${elapsed()}] 🎬 assemblage…`);
          break;
      }
    },
  });

  const output = path.join(process.env.HOME ?? ".", "Desktop", "pub-refaite.mp4");
  fs.copyFileSync(result.outputPath, output);
  await result.cleanup();

  console.log(`\n${"═".repeat(64)}`);
  console.log(`✅ ${output}`);
  console.log(
    `   ${result.durationSeconds.toFixed(1)} s · ` +
      `analyse ${result.analysisCostUsd.toFixed(2)} $ + édition ${result.editCostUsd.toFixed(2)} $ · ` +
      `${((Date.now() - started) / 1000 / 60).toFixed(1)} min`,
  );
  if (result.failed.length > 0) {
    console.log(`   ⚠️  ${result.failed.length} plan(s) en échec`);
  }
  console.log(`   Solde restant : ${(await getBalance()).toFixed(2)} $`);
}

main().catch((error) => {
  console.error(`\n❌ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
