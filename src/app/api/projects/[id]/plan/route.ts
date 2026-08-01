import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runPlanning } from "@/lib/pipeline/run-remake";

/**
 * Étape ① — lance l'analyse d'un projet.
 *
 * Répond immédiatement : le travail dure plusieurs minutes et se poursuit côté
 * serveur, même si l'onglet est fermé. Rien n'est facturé au-delà de l'analyse.
 */

export const runtime = "nodejs";
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

  // Réservation en une écriture conditionnelle : deux onglets ouverts sur la
  // même page ne lanceront pas deux analyses. Le RLS garantit au passage que le
  // projet appartient bien à l'utilisateur.
  const { data: claimed } = await supabase
    .from("projects")
    .update({ status: "planning", error_message: null })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ status: "déjà en cours" }, { status: 200 });
  }

  void runPlanning(id).catch((error) => {
    console.error(`[projet ${id}] analyse — échec non rattrapé :`, error);
  });

  return NextResponse.json({ status: "lancé" }, { status: 202 });
}
