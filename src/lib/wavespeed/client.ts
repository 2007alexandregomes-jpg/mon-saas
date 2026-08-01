/**
 * Client de l'API WaveSpeed — édition vidéo par Kling O1.
 *
 * Le modèle prend une vidéo, une consigne en langage naturel et des images de
 * référence, et rend la vidéo modifiée. C'est lui qui permet de remplacer le
 * produit d'une publicité existante par celui du client, en conservant le
 * décor, les gestes et le cadrage d'origine.
 *
 * Deux contraintes mesurées, qui expliquent l'architecture du pipeline :
 *  - il régénère un segment comme UNE scène continue : lui donner plusieurs
 *    plans d'un coup efface les coupes. D'où le découpage préalable.
 *  - il facture à la seconde, avec un minimum de 3 s par appel.
 */

const BASE_URL = "https://api.wavespeed.ai/api/v3";
const MODEL = "kwaivgi/kling-video-o1/video-edit";

/** Facturation : 0,168 $ la seconde, minimum 3 s, maximum 10 s. */
export const PRICE_PER_SECOND = 0.168;
export const MIN_BILLED_SECONDS = 3;
export const MAX_SECONDS = 10;

export function estimateCost(durationSeconds: number): number {
  return Math.max(MIN_BILLED_SECONDS, Math.min(durationSeconds, MAX_SECONDS)) *
    PRICE_PER_SECOND;
}

export type WaveSpeedStatus =
  | "created"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

const TERMINAL: WaveSpeedStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timeout",
];

export class WaveSpeedError extends Error {
  constructor(
    message: string,
    readonly status?: WaveSpeedStatus,
  ) {
    super(message);
    this.name = "WaveSpeedError";
  }
}

function apiKey(): string {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) {
    throw new WaveSpeedError("WAVESPEED_API_KEY manquante dans .env.local.");
  }
  return key;
}

/** Solde du compte, en dollars. */
export async function getBalance(): Promise<number> {
  const response = await fetch(`${BASE_URL}/balance`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new WaveSpeedError(`Solde illisible (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as { data?: { balance?: number } };
  return data.data?.balance ?? 0;
}

export type EditRequest = {
  /** URL PUBLIQUE de la vidéo à modifier. */
  videoUrl: string;
  /** La consigne, en anglais : le modèle y répond mieux. */
  prompt: string;
  /** URL publiques des photos du produit, en référence. */
  imageUrls: string[];
  keepOriginalSound?: boolean;
};

/** Lance une édition et renvoie son identifiant. */
export async function submitEdit({
  videoUrl,
  prompt,
  imageUrls,
  keepOriginalSound = true,
}: EditRequest): Promise<string> {
  const response = await fetch(`${BASE_URL}/${MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      video: videoUrl,
      images: imageUrls,
      keep_original_sound: keepOriginalSound,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const body = (await response.json().catch(() => ({}))) as {
    data?: { id?: string };
    message?: string;
  };

  if (!response.ok || !body.data?.id) {
    const detail = body.message ?? `HTTP ${response.status}`;
    if (/insufficient credits/i.test(detail)) {
      throw new WaveSpeedError(
        "Solde WaveSpeed insuffisant. Recharge sur wavespeed.ai.",
      );
    }
    throw new WaveSpeedError(`Édition refusée : ${detail}`);
  }

  return body.data.id;
}

/**
 * Attend la fin d'une édition.
 *
 * Une édition prend environ 3 minutes ; inutile d'interroger l'API chaque
 * seconde.
 */
export async function waitForEdit(
  id: string,
  {
    pollMs = 10_000,
    timeoutMs = 20 * 60_000,
    onPoll,
  }: {
    pollMs?: number;
    timeoutMs?: number;
    onPoll?: (status: WaveSpeedStatus, elapsedMs: number) => void;
  } = {},
): Promise<string> {
  const startedAt = Date.now();

  for (;;) {
    const response = await fetch(`${BASE_URL}/predictions/${id}/result`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new WaveSpeedError(`Statut illisible (HTTP ${response.status}).`);
    }

    const { data } = (await response.json()) as {
      data: { status: WaveSpeedStatus; outputs?: string[]; error?: string };
    };

    onPoll?.(data.status, Date.now() - startedAt);

    if (TERMINAL.includes(data.status)) {
      if (data.status === "completed") {
        const url = data.outputs?.[0];
        if (!url) {
          throw new WaveSpeedError("Édition terminée sans fichier de sortie.");
        }
        return url;
      }
      throw new WaveSpeedError(
        `L'édition s'est terminée en « ${data.status} »${data.error ? ` : ${data.error}` : ""}.`,
        data.status,
      );
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new WaveSpeedError(
        `L'édition dépasse ${Math.round(timeoutMs / 60_000)} minutes — abandon.`,
      );
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}
