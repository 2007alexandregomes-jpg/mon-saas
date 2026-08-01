import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { stillShot, titleCard } from "@/lib/video/still-shots";
import { assembleVideo, downloadClip, probeDuration } from "@/lib/video/assemble";
import { submitEdit, waitForEdit, estimateCost } from "@/lib/wavespeed/client";
import type { PlannedShot, VideoFormat } from "@/lib/types";

/**
 * Étape ② — exécuter un plan que le client a validé.
 *
 * On ne redécide rien ici : chaque plan porte déjà son traitement, éventuellement
 * corrigé à la main. C'est ce qui rend le résultat prévisible — le devis affiché
 * avant lancement est exactement ce qui sera facturé.
 *
 * Les extraits d'origine ont été déposés à l'analyse : inutile de re-télécharger
 * la vidéo source.
 */

export type ExecuteEvent =
  | { type: "démarrage"; edits: number; locaux: number }
  | { type: "plan terminé"; index: number }
  | { type: "plan échoué"; index: number; message: string }
  | { type: "assemblage" };

export type ExecuteResult = {
  outputPath: string;
  durationSeconds: number;
  shots: PlannedShot[];
  editCostUsd: number;
  failed: number;
  cleanup: () => Promise<void>;
};

/** Combien d'éditions payantes en même temps. */
const MAX_CONCURRENT = 6;

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Zone de recadrage pour un plan fabriqué depuis une photo.
 *
 * Volontairement serrée et prise au cœur du vêtement : sur une photo de studio,
 * tout ce qui dépasse laisse voir le fond du plan-à-plat, qui n'a rien à faire
 * au milieu d'un film tourné dehors.
 */
function cropFromHint(hint: string) {
  const h = hint.toLowerCase();
  if (/col|encolure|neck|collar/.test(h)) {
    return { x: 0.36, y: 0.16, width: 0.28, height: 0.2 };
  }
  if (/bouton|button|placket/.test(h)) {
    return { x: 0.38, y: 0.34, width: 0.24, height: 0.28 };
  }
  return { x: 0.36, y: 0.38, width: 0.28, height: 0.28 };
}

/** Devis d'un plan : seules les éditions coûtent. */
export function planCost(shots: PlannedShot[]): number {
  return shots
    .filter((s) => s.treatment === "edit")
    .reduce((total, s) => total + estimateCost(s.durationSeconds), 0);
}

export async function executePlan({
  shots,
  format,
  productDescription,
  productImageUrls,
  productImagePaths,
  brandName,
  onEvent,
}: {
  shots: PlannedShot[];
  format: VideoFormat;
  /** Description du produit, ajoutée à chaque consigne d'édition. */
  productDescription: string;
  productImageUrls: string[];
  /** Chemins locaux des photos, pour les plans fabriqués sur place. */
  productImagePaths: string[];
  brandName: string | null;
  onEvent?: (event: ExecuteEvent) => void;
}): Promise<ExecuteResult> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "execute-"));

  const kept = shots
    .filter((s) => s.treatment !== "drop")
    .sort((a, b) => a.index - b.index);

  if (kept.length === 0) {
    throw new Error("Tous les plans ont été retirés : il ne reste rien à monter.");
  }

  const edits = kept.filter((s) => s.treatment === "edit");
  onEvent?.({
    type: "démarrage",
    edits: edits.length,
    locaux: kept.length - edits.length,
  });

  try {
    const produced = await mapWithLimit(kept, MAX_CONCURRENT, async (shot) => {
      const outputPath = path.join(
        workDir,
        `plan-${String(shot.index).padStart(2, "0")}.mp4`,
      );

      try {
        if (shot.treatment === "edit") {
          // La clause d'effacement est ajoutée quoi qu'il arrive : aucun texte
          // ni logo du concurrent ne doit subsister dans la publicité du client.
          const effacement = shot.overlaidText
            ? `Remove the overlaid text and logo "${shot.overlaidText}" completely, ` +
              "leaving only the clean background behind it. "
            : "Remove any overlaid text, watermark, logo or brand name. ";

          const id = await submitEdit({
            videoUrl: shot.clipUrl,
            prompt: `${shot.editPrompt} ${effacement}The product is: ${productDescription}`,
            imageUrls: productImageUrls,
          });

          const resultUrl = await waitForEdit(id);
          await downloadClip(resultUrl, outputPath);

          // Le modèle rend parfois un peu plus long que l'entrée : on ramène à
          // la durée d'origine pour que le rythme du montage reste exact.
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

          onEvent?.({ type: "plan terminé", index: shot.index });
          return { ...shot, filePath: outputPath, resultUrl, error: null };
        }

        if (shot.treatment === "still") {
          const photo =
            productImagePaths[shot.sourceImageIndex] ?? productImagePaths[0];
          await stillShot(photo, outputPath, {
            durationSeconds: shot.durationSeconds,
            width: format.width,
            height: format.height,
            crop: cropFromHint(shot.cropHint),
            zoom: shot.index % 2 === 0 ? "in" : "out",
          });
        } else {
          await titleCard(brandName ?? "", outputPath, {
            durationSeconds: shot.durationSeconds,
            width: format.width,
            height: format.height,
          });
        }

        onEvent?.({ type: "plan terminé", index: shot.index });
        return { ...shot, filePath: outputPath, resultUrl: null, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[plan ${shot.index}] échec : ${message}`);
        onEvent?.({ type: "plan échoué", index: shot.index, message });
        return { ...shot, filePath: null, resultUrl: null, error: message };
      }
    });

    const ok = produced.filter((p) => p.filePath !== null);
    if (ok.length === 0) {
      throw new Error(
        `Aucun plan n'a pu être produit. Première cause : ${produced[0]?.error ?? "inconnue"}`,
      );
    }

    onEvent?.({ type: "assemblage" });
    const outputPath = path.join(workDir, "final.mp4");
    const assembled = await assembleVideo(
      ok.map((p) => ({
        filePath: p.filePath!,
        durationSeconds: p.durationSeconds,
      })),
      outputPath,
      format,
    );

    return {
      outputPath: assembled.outputPath,
      durationSeconds: assembled.durationSeconds,
      // On renvoie TOUS les plans, y compris ceux en échec : le client doit
      // savoir lesquels manquent et pourquoi.
      shots: produced.map(({ ...shot }) => {
        delete (shot as { filePath?: unknown }).filePath;
        return shot as PlannedShot;
      }),
      editCostUsd: planCost(kept),
      failed: produced.filter((p) => p.error !== null).length,
      cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
    };
  } catch (error) {
    // Les éditions déjà payées restent sur le disque.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\nPlans conservés dans : ${workDir}`);
  }
}
