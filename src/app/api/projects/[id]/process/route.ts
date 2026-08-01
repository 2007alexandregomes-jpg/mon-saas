import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runProject } from "@/lib/pipeline/run-project";

/**
 * Déclenche le traitement d'un projet.
 *
 * Répond immédiatement : le travail dure ~8 minutes et se poursuit côté
 * serveur, même si l'utilisateur ferme son onglet. C'est la page du projet qui
 * suit l'avancement en interrogeant la base.
 */

/** Le traitement lance des binaires (yt-dlp, ffmpeg) : runtime Node obligatoire. */
export const runtime = "nodejs";
/** Une réponse de déclenchement ne se met jamais en cache. */
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return NextResponse.json({ error: "Session illisible." }, { status: 401 });
  }

  // On « réserve » le projet en une seule écriture conditionnelle : le passage
  // de `pending` à `analyzing` ne réussit qu'une fois. Deux onglets ouverts sur
  // la même page ne lanceront donc pas deux traitements — et ne factureront pas
  // deux fois. Le RLS garantit au passage que le projet appartient bien à
  // l'utilisateur.
  const { data: claimed } = await supabase
    .from("projects")
    .update({ status: "analyzing", error_message: null })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { status: "déjà en cours ou terminé" },
      { status: 200 },
    );
  }

  // Détaché volontairement : on ne l'attend pas. `void` documente que le
  // flottement de la promesse est intentionnel, et le `catch` évite un rejet
  // non capturé qui ferait tomber le processus.
  void runProject(id, session.access_token).catch((error) => {
    console.error(`[projet ${id}] échec non rattrapé :`, error);
  });

  return NextResponse.json({ status: "lancé" }, { status: 202 });
}
