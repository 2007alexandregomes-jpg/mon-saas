import { createClient } from "@/lib/supabase/client";

/**
 * Dépôt des photos produit dans Supabase Storage, depuis le navigateur.
 *
 * On téléverse directement du navigateur vers Supabase, sans passer par notre
 * serveur : une photo de 8 Mo n'a aucune raison de faire un détour.
 *
 * Le chemin commence TOUJOURS par l'identifiant de l'utilisateur — c'est ce
 * que vérifient les politiques d'accès du bucket (migration 003). Personne ne
 * peut écrire dans le dossier d'un autre.
 */

const BUCKET = "product-images";
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export const ACCEPT_ATTRIBUTE = ACCEPTED.join(",");

export class UploadError extends Error {}

export function validateImage(file: File): string | null {
  if (!ACCEPTED.includes(file.type)) {
    return `« ${file.name} » n'est pas une image JPEG, PNG ou WebP.`;
  }
  if (file.size > MAX_BYTES) {
    return `« ${file.name} » dépasse 10 Mo (${(file.size / 1024 / 1024).toFixed(1)} Mo).`;
  }
  return null;
}

export type UploadedImage = { url: string; path: string };

/**
 * Téléverse une photo et renvoie son URL publique.
 *
 * Le bucket est public en lecture : Higgsfield doit pouvoir télécharger
 * l'image depuis ses propres serveurs pour l'animer.
 */
export async function uploadProductImage(
  file: File,
  userId: string,
): Promise<UploadedImage> {
  const supabase = createClient();

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  // Nom aléatoire : les URL sont publiques, autant qu'elles ne se devinent pas.
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw new UploadError(
      `Dépôt de « ${file.name} » impossible : ${error.message}`,
    );
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Supprime une photo — utilisé quand l'utilisateur la retire du formulaire. */
export async function removeProductImage(path: string): Promise<void> {
  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([path]);
}
