import fs from "node:fs/promises";
import path from "node:path";
import { HiggsfieldError } from "./client";

/**
 * Téléverse une image vers le stockage de Higgsfield.
 *
 * Higgsfield télécharge l'image de départ depuis ses propres serveurs : un
 * fichier local ne lui sert à rien. Cet endpoint renvoie deux URL — une adresse
 * temporaire où déposer le fichier, et l'adresse publique définitive.
 *
 * C'est utile pour tester en ligne de commande. En production, les photos
 * viendront du bucket Supabase, déjà public.
 */

const BASE_URL = "https://platform.higgsfield.ai";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

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

/** Téléverse un fichier local et renvoie son URL publique. */
export async function uploadImage(filePath: string): Promise<string> {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXTENSION[extension];
  if (!contentType) {
    throw new HiggsfieldError(
      `Format d'image non pris en charge : « ${extension || "sans extension"} ». Utilise .jpg, .png ou .webp.`,
    );
  }

  const body = await fs.readFile(filePath);

  // 1. Demander où déposer le fichier
  const urlResponse = await fetch(`${BASE_URL}/files/generate-upload-url`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content_type: contentType }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!urlResponse.ok) {
    throw new HiggsfieldError(
      `Impossible d'obtenir une adresse de dépôt (HTTP ${urlResponse.status}).`,
    );
  }

  const { public_url, upload_url } = (await urlResponse.json()) as {
    public_url: string;
    upload_url: string;
  };

  // 2. Déposer le fichier à l'adresse temporaire
  const putResponse = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(180_000),
  });

  if (!putResponse.ok) {
    throw new HiggsfieldError(
      `Le dépôt de « ${path.basename(filePath)} » a échoué (HTTP ${putResponse.status}).`,
    );
  }

  return public_url;
}

/**
 * Transforme une liste mêlant URL et chemins locaux en URL publiques.
 *
 * Ce qui commence par http(s) est laissé tel quel ; le reste est téléversé.
 */
export async function resolveImageUrls(
  entries: string[],
  onUpload?: (filePath: string, index: number) => void,
): Promise<string[]> {
  return Promise.all(
    entries.map(async (entry, index) => {
      if (/^https?:\/\//i.test(entry)) return entry;
      onUpload?.(entry, index);
      return uploadImage(entry);
    }),
  );
}
