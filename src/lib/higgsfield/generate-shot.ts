import { submit, waitForCompletion, type HiggsfieldStatus } from "./client";

/**
 * Génère UN plan : une image de départ + un mouvement → un clip d'environ 5 s.
 */

/** Les trois qualités disponibles. `turbo` est le meilleur compromis mesuré. */
export type ShotModel = "lite" | "standard" | "turbo";

export type GenerateShotInput = {
  /** URL PUBLIQUE de l'image de départ — Higgsfield la télécharge lui-même. */
  imageUrl: string;
  /** La signature visuelle commune, préfixée au mouvement du plan. */
  visualSignature: string;
  /** Le mouvement propre à ce plan. */
  motionPrompt: string;
  model?: ShotModel;
  onPoll?: (status: HiggsfieldStatus, elapsedMs: number) => void;
};

export type GeneratedShot = {
  requestId: string;
  videoUrl: string;
  elapsedMs: number;
};

export async function generateShot({
  imageUrl,
  visualSignature,
  motionPrompt,
  model = "turbo",
  onPoll,
}: GenerateShotInput): Promise<GeneratedShot> {
  const startedAt = Date.now();

  // La signature d'abord : le modèle accorde plus de poids au début du prompt,
  // et c'est elle qui garantit la cohérence entre les plans.
  const prompt = `${visualSignature.trim()} ${motionPrompt.trim()}`;

  const { requestId, statusUrl } = await submit(`higgsfield-ai/dop/${model}`, {
    prompt,
    image_url: imageUrl,
  });

  const result = await waitForCompletion(statusUrl, { onPoll });

  if (!result.videoUrl) {
    throw new Error("Higgsfield a terminé sans renvoyer d'URL vidéo.");
  }

  return {
    requestId,
    videoUrl: result.videoUrl,
    elapsedMs: Date.now() - startedAt,
  };
}
