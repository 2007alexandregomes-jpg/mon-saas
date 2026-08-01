import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { downloadVideo } from "@/lib/video/download";
import { detectShots, splitShots, extractShotFrames } from "@/lib/video/shots";
import { stillShot, titleCard } from "@/lib/video/still-shots";
import { assembleVideo, downloadClip, probeDuration } from "@/lib/video/assemble";
import { planShots, type ShotTreatment } from "@/lib/ai/plan-shots";
import {
  estimateCost,
  submitEdit,
  waitForEdit,
  MAX_SECONDS,
} from "@/lib/wavespeed/client";
import type { ProductImage } from "@/lib/ai/analyze-video";

/**
 * Refaire une publicité existante avec le produit du client.
 *
 * On part de la vidéo d'origine et on n'en change QUE le produit. Le décor, les
 * gestes, le cadrage, le rythme et les coupes restent ceux du concurrent.
 *
 *   1. Télécharger la vidéo
 *   2. Détecter les coupes et la découper en plans
 *   3. Claude regarde chaque plan et choisit son traitement
 *   4. Exécuter : édition vidéo (payante) ou fabrication locale (gratuite)
 *   5. Recoller au format d'origine
 *
 * Le découpage préalable est indispensable : le modèle d'édition régénère un
 * segment comme une scène continue, et effacerait toutes les coupes.
 */

export type RemakeEvent =
  | { type: "téléchargement" }
  | { type: "découpage"; shots: number }
  | { type: "analyse" }
  | {
      type: "plan prévu";
      index: number;
      treatment: ShotTreatment;
      content: string;
      reason: string;
      /** Le texte incrusté relevé dans ce plan, à effacer. */
      overlaidText: string;
      /** La consigne rédigée pour le modèle d'édition. */
      editPrompt: string;
    }
  | { type: "plans lancés"; edits: number; locaux: number; coutEstime: number }
  | { type: "plan terminé"; index: number; treatment: ShotTreatment }
  | { type: "plan échoué"; index: number; message: string }
  | { type: "assemblage" }
  | { type: "terminé"; outputPath: string; durationSeconds: number };

export type RemakeResult = {
  outputPath: string;
  durationSeconds: number;
  plan: Awaited<ReturnType<typeof planShots>>["plan"];
  analysisCostUsd: number;
  editCostUsd: number;
  failed: { index: number; message: string }[];
  cleanup: () => Promise<void>;
};

/** Combien d'éditions payantes en même temps. */
const MAX_CONCURRENT = 6;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Traduit une indication de cadrage en zone de recadrage.
 *
 * Les zones sont volontairement SERRÉES et prises au cœur du vêtement : sur une
 * photo de studio, tout ce qui dépasse du produit laisse voir le fond du
 * plan-à-plat — un tapis gris au milieu d'une publicité tournée dehors se
 * remarque immédiatement.
 */
function cropFromHint(hint: string) {
  const h = hint.toLowerCase();

  if (/col|encolure|neck|collar/.test(h)) {
    return { x: 0.36, y: 0.16, width: 0.28, height: 0.2 };
  }
  if (/bouton|button|placket/.test(h)) {
    return { x: 0.38, y: 0.34, width: 0.24, height: 0.28 };
  }
  // Par défaut : plein cœur du vêtement, là où il n'y a que de la matière.
  return { x: 0.36, y: 0.38, width: 0.28, height: 0.28 };
}

export async function remakeVideo({
  url,
  product,
  productImages,
  productImageUrls,
  productImagePaths,
  options,
  uploadPublic,
  onEvent,
}: {
  url: string;
  product: { name: string; description: string | null };
  /** Les photos en base64, pour que Claude les regarde. */
  productImages: ProductImage[];
  /** Leurs URL publiques, pour le modèle d'édition. */
  productImageUrls: string[];
  /** Leurs chemins locaux, pour fabriquer les plans fixes. */
  productImagePaths: string[];
  options: {
    replacePeople: boolean;
    brandCards: { mode: "replace" | "drop"; text?: string };
  };
  /**
   * Rend un fichier local accessible par une URL publique.
   *
   * Le modèle d'édition télécharge la vidéo depuis ses propres serveurs : un
   * fichier local ne lui sert à rien.
   */
  uploadPublic: (filePath: string, key: string) => Promise<string>;
  onEvent?: (event: RemakeEvent) => void;
}): Promise<RemakeResult> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "remake-"));

  onEvent?.({ type: "téléchargement" });
  const video = await downloadVideo(url);

  try {
    // ------------------------------------------------------------- découpage
    const detected = await detectShots(video.filePath);
    const shots = await splitShots(
      video.filePath,
      detected,
      path.join(workDir, "plans"),
    );
    onEvent?.({ type: "découpage", shots: shots.length });

    const format = {
      width: video.width ?? 1080,
      height: video.height ?? 1920,
    };

    // --------------------------------------------------------------- analyse
    onEvent?.({ type: "analyse" });

    const framesByShot = await Promise.all(
      shots.map(async (shot) => {
        const paths = await extractShotFrames(
          shot.filePath!,
          path.join(workDir, "images"),
        );
        return Promise.all(
          paths.map(async (p) => ({
            data: (await fs.readFile(p)).toString("base64"),
            mediaType: "image/jpeg" as const,
          })),
        );
      }),
    );

    const { plan, costUsd: analysisCostUsd } = await planShots({
      shots: shots.map((s, i) => ({
        index: s.index,
        durationSeconds: s.durationSeconds,
        frames: framesByShot[i],
      })),
      productImages,
      product,
      replacePeople: options.replacePeople,
      brandCards: options.brandCards,
    });

    for (const p of plan.shots) {
      onEvent?.({
        type: "plan prévu",
        index: p.index,
        treatment: p.treatment,
        content: p.content,
        reason: p.reason,
        overlaidText: p.overlaidText,
        editPrompt: p.editPrompt,
      });
    }

    const kept = plan.shots.filter((p) => p.treatment !== "drop");
    const edits = kept.filter((p) => p.treatment === "edit");
    const coutEstime = edits.reduce((total, p) => {
      const shot = shots.find((s) => s.index === p.index);
      return total + estimateCost(shot?.durationSeconds ?? 3);
    }, 0);

    onEvent?.({
      type: "plans lancés",
      edits: edits.length,
      locaux: kept.length - edits.length,
      coutEstime,
    });

    // ------------------------------------------------------------- exécution
    const failed: { index: number; message: string }[] = [];

    const produced = await mapWithLimit(kept, MAX_CONCURRENT, async (p) => {
      const shot = shots.find((s) => s.index === p.index);
      if (!shot?.filePath) return null;

      const outputPath = path.join(
        workDir,
        `final-${String(p.index).padStart(2, "0")}.mp4`,
      );

      try {
        if (p.treatment === "edit") {
          // Le modèle plafonne à 10 s ; au-delà on tronque plutôt que d'échouer.
          const publicUrl = await uploadPublic(
            shot.filePath,
            `plan-${p.index}-${Date.now()}.mp4`,
          );
          // Clause ajoutée systématiquement : même quand Claude oublie de le
          // demander, aucun texte ni logo du concurrent ne doit subsister —
          // ce serait diffuser sa marque dans la publicité du client.
          const effacement = p.overlaidText
            ? `Remove the overlaid text and logo "${p.overlaidText}" completely, ` +
              "leaving only the clean background behind it. "
            : "Remove any overlaid text, watermark, logo or brand name. ";

          const id = await submitEdit({
            videoUrl: publicUrl,
            prompt:
              `${p.editPrompt} ${effacement}` +
              `The product is: ${plan.productDescription}`,
            imageUrls: productImageUrls,
          });
          const resultUrl = await waitForEdit(id);
          await downloadClip(resultUrl, outputPath);

          // Le modèle rend parfois un peu plus long que l'entrée : on ramène à
          // la durée d'origine pour que le montage reste au rythme exact.
          const produced = await probeDuration(outputPath);
          if (produced > shot.durationSeconds + 0.05) {
            const trimmed = outputPath.replace(".mp4", "-court.mp4");
            await assembleVideo(
              [{ filePath: outputPath, durationSeconds: shot.durationSeconds }],
              trimmed,
              format,
            );
            await fs.rename(trimmed, outputPath);
          }
        } else if (p.treatment === "still") {
          const photo =
            productImagePaths[p.sourceImageIndex] ?? productImagePaths[0];
          await stillShot(photo, outputPath, {
            durationSeconds: shot.durationSeconds,
            width: format.width,
            height: format.height,
            crop: cropFromHint(p.cropHint),
            zoom: p.index % 2 === 0 ? "in" : "out",
          });
        } else {
          await titleCard(
            options.brandCards.text ?? product.name,
            outputPath,
            {
              durationSeconds: shot.durationSeconds,
              width: format.width,
              height: format.height,
            },
          );
        }

        onEvent?.({ type: "plan terminé", index: p.index, treatment: p.treatment });
        return { index: p.index, filePath: outputPath, durationSeconds: shot.durationSeconds };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[plan ${p.index}] échec : ${message}`);
        onEvent?.({ type: "plan échoué", index: p.index, message });
        failed.push({ index: p.index, message });
        return null;
      }
    });

    const ok = produced
      .filter((p) => p !== null)
      .sort((a, b) => a.index - b.index);

    if (ok.length === 0) {
      throw new Error(
        `Aucun plan n'a pu être produit. Première cause : ${failed[0]?.message ?? "inconnue"}`,
      );
    }

    // ------------------------------------------------------------ assemblage
    onEvent?.({ type: "assemblage" });
    const outputPath = path.join(workDir, "final.mp4");
    const assembled = await assembleVideo(
      ok.map((p) => ({
        filePath: p.filePath,
        durationSeconds: p.durationSeconds,
      })),
      outputPath,
      format,
    );

    onEvent?.({
      type: "terminé",
      outputPath: assembled.outputPath,
      durationSeconds: assembled.durationSeconds,
    });

    return {
      outputPath: assembled.outputPath,
      durationSeconds: assembled.durationSeconds,
      plan,
      analysisCostUsd,
      editCostUsd: coutEstime,
      failed,
      cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
    };
  } catch (error) {
    // Les plans déjà édités ont coûté de l'argent : on ne supprime rien.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\n\nLes plans déjà produits sont conservés dans :\n  ${workDir}`,
    );
  } finally {
    await video.cleanup();
  }
}

export { MAX_SECONDS };
