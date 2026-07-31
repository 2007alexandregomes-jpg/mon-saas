import fs from "node:fs/promises";
import path from "node:path";

/**
 * Transcription audio via Groq (Whisper large-v3-turbo).
 *
 * L'API de Groq est compatible avec celle d'OpenAI, donc un simple `fetch`
 * multipart suffit — inutile d'ajouter un SDK pour un seul endpoint.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export async function transcribeAudio(
  audioPath: string,
  { language = "fr" }: { language?: string } = {},
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new TranscriptionError(
      "GROQ_API_KEY est absente. Ajoute-la dans .env.local puis redémarre le serveur.",
    );
  }

  const buffer = await fs.readFile(audioPath);

  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(buffer)], path.basename(audioPath), {
      type: "audio/mpeg",
    }),
  );
  form.append("model", MODEL);
  form.append("response_format", "text");
  // Indiquer la langue évite que Whisper « traduise » un mot sur deux quand
  // l'audio est bruité ou l'accent marqué.
  form.append("language", language);

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new TranscriptionError("Clé Groq refusée (401). Vérifie GROQ_API_KEY.");
    }
    if (response.status === 429) {
      throw new TranscriptionError(
        "Quota Groq atteint (429). Réessaie dans quelques minutes.",
      );
    }
    throw new TranscriptionError(
      `Transcription impossible (HTTP ${response.status}) ${detail.slice(0, 200)}`,
    );
  }

  const text = (await response.text()).trim();
  return text;
}
