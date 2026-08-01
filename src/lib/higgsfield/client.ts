/**
 * Client de l'API Higgsfield.
 *
 * L'API est asynchrone : on soumet une requête, on reçoit un identifiant, puis
 * on interroge une URL de statut jusqu'à ce que ce soit prêt. Une génération
 * vidéo prend environ 5 minutes.
 *
 * Authentification : `Authorization: Key <clé>:<secret>` — ce n'est PAS du
 * HTTP Basic, contrairement à ce que laisse croire une partie de la
 * documentation tierce.
 */

const BASE_URL = "https://platform.higgsfield.ai";

export type HiggsfieldStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

/** Les statuts qui ne changeront plus. */
const TERMINAL: HiggsfieldStatus[] = ["completed", "failed", "nsfw", "canceled"];

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    readonly status?: HiggsfieldStatus,
  ) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

function authHeader(): string {
  const key = process.env.HIGGSFIELD_API_KEY;
  const secret = process.env.HIGGSFIELD_API_SECRET;
  if (!key || !secret) {
    throw new HiggsfieldError(
      "HIGGSFIELD_API_KEY ou HIGGSFIELD_API_SECRET manquante dans .env.local.",
    );
  }
  return `Key ${key}:${secret}`;
}

/** Traduit les erreurs de l'API en messages compréhensibles. */
async function toError(response: Response): Promise<HiggsfieldError> {
  const raw = await response.text().catch(() => "");
  let detail = raw;
  try {
    detail = JSON.parse(raw).detail ?? raw;
  } catch {
    // Le corps n'était pas du JSON : on garde le texte brut.
  }

  if (typeof detail === "string") {
    if (detail.includes("not_enough_credits")) {
      return new HiggsfieldError(
        "Crédits Higgsfield épuisés. Recharge sur cloud.higgsfield.ai.",
      );
    }
    if (detail.includes("model_not_found")) {
      return new HiggsfieldError(
        "Ce modèle n'est pas accessible sur ce compte Higgsfield.",
      );
    }
    if (detail.includes("invalid_image_url")) {
      return new HiggsfieldError(
        "Higgsfield n'a pas pu télécharger l'image. Elle doit être accessible publiquement.",
      );
    }
  }
  if (response.status === 401) {
    return new HiggsfieldError("Identifiants Higgsfield refusés (401).");
  }

  return new HiggsfieldError(
    `Higgsfield a répondu ${response.status} : ${JSON.stringify(detail).slice(0, 300)}`,
  );
}

export type SubmitResult = {
  requestId: string;
  statusUrl: string;
  cancelUrl: string;
};

/**
 * Lance une génération.
 *
 * `application` est le chemin du modèle, par exemple `higgsfield-ai/dop/turbo`.
 */
export async function submit(
  application: string,
  body: Record<string, unknown>,
): Promise<SubmitResult> {
  const response = await fetch(`${BASE_URL}/${application}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw await toError(response);

  const data = (await response.json()) as {
    request_id: string;
    status_url: string;
    cancel_url: string;
  };

  return {
    requestId: data.request_id,
    statusUrl: data.status_url,
    cancelUrl: data.cancel_url,
  };
}

export type StatusResult = {
  status: HiggsfieldStatus;
  videoUrl: string | null;
  imageUrls: string[];
};

export async function getStatus(statusUrl: string): Promise<StatusResult> {
  const response = await fetch(statusUrl, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw await toError(response);

  const data = (await response.json()) as {
    status: HiggsfieldStatus;
    video?: { url?: string };
    images?: { url: string }[];
  };

  return {
    status: data.status,
    videoUrl: data.video?.url ?? null,
    imageUrls: (data.images ?? []).map((i) => i.url),
  };
}

/**
 * Interroge le statut jusqu'à ce qu'il soit définitif.
 *
 * `pollMs` est volontairement large : une génération dure ~5 minutes, inutile
 * de marteler l'API toutes les secondes.
 */
export async function waitForCompletion(
  statusUrl: string,
  {
    pollMs = 8_000,
    timeoutMs = 15 * 60_000,
    onPoll,
  }: {
    pollMs?: number;
    timeoutMs?: number;
    onPoll?: (status: HiggsfieldStatus, elapsedMs: number) => void;
  } = {},
): Promise<StatusResult> {
  const startedAt = Date.now();

  for (;;) {
    const result = await getStatus(statusUrl);
    onPoll?.(result.status, Date.now() - startedAt);

    if (TERMINAL.includes(result.status)) {
      if (result.status === "completed") return result;
      if (result.status === "nsfw") {
        throw new HiggsfieldError(
          "Higgsfield a refusé ce contenu (nsfw). Reformule le plan ou change de photo.",
          "nsfw",
        );
      }
      throw new HiggsfieldError(
        `La génération s'est terminée en « ${result.status} ».`,
        result.status,
      );
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new HiggsfieldError(
        `La génération dépasse ${Math.round(timeoutMs / 60_000)} minutes — abandon.`,
      );
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Annule une génération en cours (les crédits déjà consommés ne reviennent pas). */
export async function cancel(cancelUrl: string): Promise<void> {
  await fetch(cancelUrl, {
    method: "POST",
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => {
    // Une annulation qui échoue ne doit pas masquer l'erreur d'origine.
  });
}
