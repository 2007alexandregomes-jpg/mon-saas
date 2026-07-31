"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Action de déconnexion.
 *
 * `"use server"` en haut du fichier veut dire : ces fonctions s'exécutent sur
 * le serveur, mais peuvent être appelées directement depuis un `<form>` côté
 * client. Pas besoin d'écrire une API à la main.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
