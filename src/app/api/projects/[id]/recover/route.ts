import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Débloque un projet dont le traitement s'est arrêté sans conclure.
 *
 * Le montage se termine sur le disque avant d'être déposé dans Supabase. Si le
 * dépôt échoue, la vidéo existe mais le projet reste marqué « en cours ». Cette
 * route la retrouve et termine le travail.
 *
 * Différence essentielle avec le traitement de fond : elle s'exécute dans une
 * requête normale, donc avec la session de l'utilisateur — pas avec le client
 * détaché. Si le dépôt réussit ici et échouait là-bas, c'est bien le client
 * détaché qui est en cause.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Le montage le plus récent laissé sur le disque par un traitement. */
async function findLatestAssembly(): Promise<string | null> {
  const tmp = os.tmpdir();
  const entries = await fs.readdir(tmp).catch(() => []);

  const candidates: { filePath: string; mtimeMs: number }[] = [];

  for (const entry of entries) {
    if (!entry.startsWith("hf-generate-")) continue;
    const filePath = path.join(tmp, entry, "final.mp4");
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) candidates.push({ filePath, mtimeMs: stat.mtimeMs });
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.filePath ?? null;
}

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

  const filePath = await findLatestAssembly();
  if (!filePath) {
    return NextResponse.json(
      { error: "Aucun montage trouvé sur le disque. Il faut relancer." },
      { status: 404 },
    );
  }

  const bytes = await fs.readFile(filePath);
  const storagePath = `${user.id}/${id}.mp4`;

  const { error: uploadError } = await supabase.storage
    .from("generated-videos")
    .upload(storagePath, bytes, { contentType: "video/mp4", upsert: true });

  if (uploadError) {
    // Ce message est précieux : il dit si le dépôt échoue AUSSI avec une
    // session normale, ou seulement avec le client détaché.
    return NextResponse.json(
      { error: `Dépôt refusé : ${uploadError.message}` },
      { status: 500 },
    );
  }

  const { data: publicUrl } = supabase.storage
    .from("generated-videos")
    .getPublicUrl(storagePath);

  const { error: updateError } = await supabase
    .from("projects")
    .update({
      status: "completed",
      generated_video_url: publicUrl.publicUrl,
      error_message:
        "Vidéo récupérée manuellement : le dépôt automatique avait échoué.",
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json(
      { error: `Écriture en base refusée : ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "récupérée",
    url: publicUrl.publicUrl,
    source: filePath,
    octets: bytes.length,
  });
}
