import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { downloadVideo } from "@/lib/video/download";
import { detectShots, splitShots, extractShotFrames } from "@/lib/video/shots";
import { planShots } from "@/lib/ai/plan-shots";
import type { ProductImage } from "@/lib/ai/analyze-video";
import type { PlannedShot, VideoFormat } from "@/lib/types";

/**
 * Étape ① — analyser une publicité et proposer un plan de travail.
 *
 * Rien n'est édité ici, donc rien n'est facturé au-delà de l'analyse (~0,15 $).
 * Le client verra le plan, pourra le corriger, et c'est lui qui déclenchera les
 * éditions payantes.
 *
 * Les extraits de plans sont déposés dans le stockage au passage : le modèle
 * d'édition les télécharge depuis ses propres serveurs, et les conserver évite
 * de re-télécharger la vidéo source entre l'analyse et l'exécution.
 */

export type PlanProjectResult = {
  shots: PlannedShot[];
  format: VideoFormat;
  productDescription: string;
  costUsd: number;
};

export async function planProject({
  url,
  product,
  productImages,
  options,
  uploadPublic,
  onEvent,
}: {
  url: string;
  product: { name: string; description: string | null };
  productImages: ProductImage[];
  options: {
    replacePeople: boolean;
    brandCards: { mode: "replace" | "drop"; text?: string };
  };
  uploadPublic: (
    filePath: string,
    key: string,
    contentType: string,
  ) => Promise<string>;
  onEvent?: (step: string) => void;
}): Promise<PlanProjectResult> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-"));

  onEvent?.("téléchargement");
  const video = await downloadVideo(url);

  try {
    onEvent?.("découpage");
    const detected = await detectShots(video.filePath);
    const shots = await splitShots(
      video.filePath,
      detected,
      path.join(workDir, "plans"),
    );

    const format: VideoFormat = {
      width: video.width ?? 1080,
      height: video.height ?? 1920,
    };

    // Dépôt des extraits et d'une vignette par plan. En parallèle : ce sont de
    // petits fichiers, et l'attente serait inutilement longue en série.
    onEvent?.("dépôt des extraits");
    const stamp = Date.now();

    const uploaded = await Promise.all(
      shots.map(async (shot) => {
        const framePaths = await extractShotFrames(
          shot.filePath!,
          path.join(workDir, "images"),
        );

        const [clipUrl, thumbUrl] = await Promise.all([
          uploadPublic(
            shot.filePath!,
            `${stamp}/plan-${shot.index}.mp4`,
            "video/mp4",
          ),
          uploadPublic(
            framePaths[Math.floor(framePaths.length / 2)],
            `${stamp}/plan-${shot.index}.jpg`,
            "image/jpeg",
          ),
        ]);

        const frames = await Promise.all(
          framePaths.map(async (p) => ({
            data: (await fs.readFile(p)).toString("base64"),
            mediaType: "image/jpeg" as const,
          })),
        );

        return { shot, frames, clipUrl, thumbUrl };
      }),
    );

    onEvent?.("analyse");
    const { plan, costUsd } = await planShots({
      shots: uploaded.map((u) => ({
        index: u.shot.index,
        durationSeconds: u.shot.durationSeconds,
        frames: u.frames,
      })),
      productImages,
      product,
      replacePeople: options.replacePeople,
      brandCards: options.brandCards,
    });

    const planned: PlannedShot[] = uploaded.map((u) => {
      const decision = plan.shots.find((s) => s.index === u.shot.index);
      return {
        index: u.shot.index,
        startSeconds: u.shot.startSeconds,
        durationSeconds: u.shot.durationSeconds,
        clipUrl: u.clipUrl,
        thumbUrl: u.thumbUrl,
        content: decision?.content ?? "",
        reason: decision?.reason ?? "",
        overlaidText: decision?.overlaidText ?? "",
        treatment: decision?.treatment ?? "edit",
        editPrompt: decision?.editPrompt ?? "",
        sourceImageIndex: decision?.sourceImageIndex ?? 0,
        cropHint: decision?.cropHint ?? "",
        resultUrl: null,
        error: null,
      };
    });

    return {
      shots: planned,
      format,
      productDescription: plan.productDescription,
      costUsd,
    };
  } finally {
    await video.cleanup();
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
