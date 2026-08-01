"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Ce que l'action renvoie au formulaire pour qu'il affiche un message. */
export type CreateProjectState = {
  error?: string;
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
 * Crée un projet, puis redirige vers sa page.
 *
 * Le traitement lui-même (analyse + génération, ~8 minutes) n'est PAS lancé
 * ici : une Server Action doit répondre vite. C'est la page du projet qui le
 * déclenche, et il se poursuit côté serveur même si l'onglet est fermé.
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
  const forceVoiceover = formData.get("force_voiceover") === "on";

  // Les photos sont déjà dans le bucket : le formulaire ne transmet que leurs URL.
  let imageUrls: string[] = [];
  try {
    imageUrls = JSON.parse(String(formData.get("product_image_urls") ?? "[]"));
  } catch {
    return { error: "Les photos n'ont pas pu être lues. Recharge la page." };
  }

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
  if (imageUrls.length === 0) {
    return {
      error:
        "Ajoute au moins une photo de ton produit — c'est elle que la vidéo animera.",
    };
  }
  if (!imageUrls.every(isHttpUrl)) {
    return { error: "Une des photos a une adresse invalide. Retire-la et réessaie." };
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      competitor_video_url: competitorVideoUrl,
      product_name: productName,
      product_description: productDescription || null,
      product_image_urls: imageUrls,
      status: "pending",
      // Stocké dans les notes le temps qu'une colonne dédiée existe : la voix
      // off n'est pas encore implémentée, mais le choix de l'utilisateur ne
      // doit pas être perdu.
      notes: forceVoiceover ? "voix-off-demandée" : null,
    })
    .select("id")
    .single();

  if (error) {
    return { error: `Enregistrement impossible : ${error.message}` };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/${data.id}`);
}
