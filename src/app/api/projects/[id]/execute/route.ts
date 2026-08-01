import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runExecution } from "@/lib/pipeline/run-remake";
import { planCost } from "@/lib/pipeline/execute-plan";
import type { PlannedShot } from "@/lib/types";

/**
 * Étape ② — exécute le plan validé par le client.
 *
 * C'est le seul endroit du produit qui engage une dépense. Le corps de la
 * requête porte le plan corrigé par le client : ses choix priment sur ceux
 * proposés par l'analyse.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
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

  const body = (await request.json().catch(() => ({}))) as {
    shots?: PlannedShot[];
  };

  if (!body.shots || body.shots.length === 0) {
    return NextResponse.json({ error: "Plan manquant." }, { status: 400 });
  }

  // Le plan corrigé est enregistré AVANT la réservation : si l'utilisateur a
  // changé des traitements, c'est sa version qui doit être exécutée.
  const { error: saveError } = await supabase
    .from("projects")
    .update({
      shot_plan: body.shots,
      edit_cost_usd: Number(planCost(body.shots).toFixed(4)),
    })
    .eq("id", id)
    .eq("status", "awaiting_approval");

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  const { data: claimed } = await supabase
    .from("projects")
    .update({ status: "generating", error_message: null })
    .eq("id", id)
    .eq("status", "awaiting_approval")
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "Ce projet n'attend pas de validation." },
      { status: 409 },
    );
  }

  void runExecution(id).catch((error) => {
    console.error(`[projet ${id}] exécution — échec non rattrapé :`, error);
  });

  return NextResponse.json({ status: "lancé" }, { status: 202 });
}
