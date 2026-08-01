import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { generateShot, type ShotModel } from "@/lib/higgsfield/generate-shot";
import { assembleVideo, downloadClip } from "@/lib/video/assemble";
import type { HiggsfieldStatus } from "@/lib/higgsfield/client";

/**
 * De la liste de plans à la vidéo finale.
 *
 *   1. Lancer TOUS les plans en même temps chez Higgsfield
 *   2. Télécharger chaque clip dès qu'il est prêt
 *   3. Couper chacun à sa durée et les recoller
 *
 * Le parallélisme n'est pas un luxe : une génération prend ~5 minutes. En
 * séquentiel, une pub de 6 plans demanderait une demi-heure ; lancées
 * ensemble, elles terminent en ~6 minutes (mesuré).
 */

export type ShotToGenerate = {
  durationSeconds: number;
  motionPrompt: string;
  /** URL publique de l'image de départ de ce plan. */
  imageUrl: string;
};

export type GenerationEvent =
  | { type: "plans lancés"; count: number }
  | {
      type: "plan";
      index: number;
      status: HiggsfieldStatus;
      elapsedMs: number;
    }
  | { type: "plan terminé"; index: number; elapsedMs: number }
  | { type: "plan échoué"; index: number; message: string }
  | { type: "assemblage" }
  | { type: "terminé"; outputPath: string; durationSeconds: number };

export type GenerationResult = {
  outputPath: string;
  durationSeconds: number;
  shots: { index: number; requestId: string; videoUrl: string }[];
  /** Nettoie les clips intermédiaires. À appeler une fois la vidéo copiée. */
  cleanup: () => Promise<void>;
};

/**
 * Limite le nombre de générations simultanées.
 *
 * Sans plafond, une pub de 20 plans ouvrirait 20 requêtes d'un coup et se
 * ferait probablement limiter par l'API.
 */
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
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export async function generateVideo({
  shots,
  visualSignature,
  model = "turbo",
  onEvent,
}: {
  shots: ShotToGenerate[];
  visualSignature: string;
  model?: ShotModel;
  onEvent?: (event: GenerationEvent) => void;
}): Promise<GenerationResult> {
  if (shots.length === 0) {
    throw new Error("Aucun plan à générer.");
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hf-generate-"));
  onEvent?.({ type: "plans lancés", count: shots.length });

  try {
    const generated = await mapWithLimit(
      shots,
      MAX_CONCURRENT,
      async (shot, index) => {
        try {
          const result = await generateShot({
            imageUrl: shot.imageUrl,
            visualSignature,
            motionPrompt: shot.motionPrompt,
            model,
            onPoll: (status, elapsedMs) =>
              onEvent?.({ type: "plan", index, status, elapsedMs }),
          });

          const filePath = await downloadClip(
            result.videoUrl,
            path.join(workDir, `shot-${String(index).padStart(2, "0")}.mp4`),
          );

          onEvent?.({
            type: "plan terminé",
            index,
            elapsedMs: result.elapsedMs,
          });

          return { index, filePath, ...result };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          onEvent?.({ type: "plan échoué", index, message });
          return null;
        }
      },
    );

    const ok = generated.filter((g) => g !== null);
    if (ok.length === 0) {
      throw new Error("Tous les plans ont échoué — aucune vidéo à assembler.");
    }

    onEvent?.({ type: "assemblage" });
    const outputPath = path.join(workDir, "final.mp4");
    const assembled = await assembleVideo(
      ok.map((g) => ({
        filePath: g.filePath,
        durationSeconds: shots[g.index].durationSeconds,
      })),
      outputPath,
    );

    onEvent?.({
      type: "terminé",
      outputPath: assembled.outputPath,
      durationSeconds: assembled.durationSeconds,
    });

    return {
      outputPath: assembled.outputPath,
      durationSeconds: assembled.durationSeconds,
      shots: ok.map((g) => ({
        index: g.index,
        requestId: g.requestId,
        videoUrl: g.videoUrl,
      })),
      cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    throw error;
  }
}
