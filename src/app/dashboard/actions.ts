"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Ce que l'action renvoie au formulaire pour qu'il affiche un message. */
export type CreateProjectState = {
  error?: string;
  /** Change à chaque succès : sert au formulaire à savoir qu'il doit se vider. */
  successId?: string;
};

/** Accepte uniquement une vraie adresse http(s). */
function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Crée un projet pour l'utilisateur connecté.
 *
 * Tout se passe sur le serveur : le navigateur ne choisit pas le `user_id`,
 * on le lit depuis la session. Et même si quelqu'un trafiquait la requête,
 * le RLS de Postgres refuserait d'écrire une ligne au nom d'un autre.
 */
export async function createProject(
  _prevState: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Ta session a expiré. Reconnecte-toi puis réessaie." };
  }

  const competitorVideoUrl = String(
    formData.get("competitor_video_url") ?? "",
  ).trim();
  const productName = String(formData.get("product_name") ?? "").trim();
  const productDescription = String(
    formData.get("product_description") ?? "",
  ).trim();
  const productImageUrl = String(formData.get("product_image_url") ?? "").trim();

  // --- Validations (le `required` du HTML ne suffit pas : il se contourne) ---
  if (!competitorVideoUrl) {
    return { error: "Le lien de la vidéo concurrente est obligatoire." };
  }
  if (!isHttpUrl(competitorVideoUrl)) {
    return {
      error:
        "Le lien de la vidéo doit commencer par http:// ou https:// — copie-le depuis la barre d'adresse.",
    };
  }
  if (!productName) {
    return { error: "Le nom du produit est obligatoire." };
  }
  if (productName.length > 200) {
    return { error: "Le nom du produit est trop long (200 caractères max)." };
  }
  if (productImageUrl && !isHttpUrl(productImageUrl)) {
    return {
      error:
        "Le lien de l'image doit commencer par http:// ou https://, ou rester vide.",
    };
  }

  const { error } = await supabase.from("projects").insert({
    user_id: user.id,
    competitor_video_url: competitorVideoUrl,
    product_name: productName,
    // Colonnes optionnelles : on écrit null plutôt qu'une chaîne vide.
    product_description: productDescription || null,
    product_image_url: productImageUrl || null,
  });

  if (error) {
    return { error: `Enregistrement impossible : ${error.message}` };
  }

  // Invalide le cache de /dashboard pour que la liste se recharge avec le
  // nouveau projet, sans recharger la page à la main.
  revalidatePath("/dashboard");

  return { successId: crypto.randomUUID() };
}
