import fs from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { analyzeCompetitorVideo } from "@/lib/pipeline/analyze-competitor-video";
import { generateVideo } from "@/lib/pipeline/generate-video";
import { prepareProductImage } from "@/lib/video/prepare-image";
import { uploadImage } from "@/lib/higgsfield/upload";
import type { ImageMediaType, ProductImage } from "@/lib/ai/analyze-video";
import type { Project } from "@/lib/types";
import path from "node:path";
import os from "node:os";

/**
 * Le traitement complet d'un projet, du lien à la vidéo finale.
 *
 * Cette fonction tourne DÉTACHÉE de la requête HTTP : elle dure ~8 minutes,
 * bien au-delà de ce qu'un navigateur accepte d'attendre. Elle écrit son
 * avancement en base à chaque étape, et c'est la page du projet qui le lit.
 *
 * Conséquence : aucune exception ne doit s'en échapper sans avoir été écrite
 * en base, sinon le projet resterait bloqué en « analyse » pour toujours.
 */

/**
 * Client Supabase utilisable APRÈS la fin de la requête.
 *
 * Le client habituel lit les cookies à chaque appel — or les cookies n'existent
 * plus une fois la réponse envoyée. On fige donc le jeton de l'utilisateur au
 * moment du lancement.
 */
export function createDetachedClient(accessToken: string): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Devine le format d'après les premiers octets, jamais d'après l'extension. */
function detectMediaType(buffer: Buffer): ImageMediaType | null {
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP")
    return "image/webp";
  if (buffer.subarray(0, 3).toString() === "GIF") return "image/gif";
  return null;
}

async function fetchImage(url: string): Promise<{ buffer: Buffer; media: ImageMediaType }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`Photo inaccessible (HTTP ${response.status}) : ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const media = detectMediaType(buffer);
  if (!media) throw new Error(`Format d'image non reconnu : ${url}`);
  return { buffer, media };
}

export async function runProject(projectId: string, accessToken: string) {
  const supabase = createDetachedClient(accessToken);

  /**
   * Écrit l'avancement. Le trigger `updated_at` s'occupe de l'horodatage.
   *
   * Supabase ne LÈVE PAS d'exception quand une écriture échoue : il renvoie un
   * objet `error`. Sans cette vérification, une écriture ratée passe inaperçue
   * et le projet reste bloqué à son statut précédent pour toujours.
   */
  const update = async (patch: Partial<Project>) => {
    const { error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", projectId);

    if (error) {
      console.error(
        `[projet ${projectId}] ÉCRITURE EN BASE REFUSÉE (${Object.keys(patch).join(", ")}) : ${error.message}`,
      );
      throw new Error(`Écriture en base impossible : ${error.message}`);
    }
  };

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-"));

  try {
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .single<Project>();

    if (error || !project) {
      throw new Error("Projet introuvable.");
    }

    // ---------------------------------------------------------------- analyse
    const images: ProductImage[] = [];
    const localPhotos: string[] = [];

    for (const [index, url] of project.product_image_urls.entries()) {
      const { buffer, media } = await fetchImage(url);
      images.push({ data: buffer.toString("base64"), mediaType: media });

      const localPath = path.join(workDir, `photo-${index}`);
      await fs.writeFile(localPath, buffer);
      localPhotos.push(localPath);
    }

    const analysis = await analyzeCompetitorVideo({
      onEvent: (event) =>
        console.log(`[projet ${projectId}] ${event.step} — ${event.status}`),
      url: project.competitor_video_url,
      product: {
        name: project.product_name,
        description: project.product_description,
        images,
      },
      options: { forceVoiceover: project.notes === "voix-off-demandée" },
    });

    await update({
      status: "generating",
      reference_transcript: analysis.analysis.referenceFormat.summary,
      reference_format: analysis.analysis.referenceFormat,
      style: analysis.analysis.style,
      original_script: analysis.analysis.originalScript,
      adapted_script: analysis.analysis.adaptedScript,
      visual_signature: analysis.analysis.visualSignature,
      shots: analysis.analysis.shots,
      notes: analysis.analysis.notes,
      analysis_cost_usd: Number(analysis.usage.costUsd.toFixed(4)),
    });

    // ------------------------------------------------------------- génération
    // Higgsfield calque le format de la vidéo sur celui de l'image d'entrée :
    // toutes les photos doivent donc avoir le format de la référence.
    const targetFormat =
      analysis.video.width && analysis.video.height
        ? { width: analysis.video.width, height: analysis.video.height }
        : undefined;

    const imageUrls: string[] = [];
    for (const localPath of localPhotos) {
      const prepared = await prepareProductImage(localPath, workDir, targetFormat);
      imageUrls.push(await uploadImage(prepared.filePath));
    }

    const generated = await generateVideo({
      onEvent: (event) => {
        if (event.type === "plan échoué") {
          console.error(
            `[projet ${projectId}] plan ${event.index + 1} échoué : ${event.message}`,
          );
        } else if (event.type !== "plan") {
          console.log(`[projet ${projectId}] ${event.type}`);
        }
      },
      visualSignature: analysis.analysis.visualSignature,
      targetFormat,
      shots: analysis.analysis.shots.map((shot) => ({
        durationSeconds: shot.durationSeconds,
        motionPrompt: shot.motionPrompt,
        imageUrl: imageUrls[shot.sourceImageIndex] ?? imageUrls[0],
      })),
    });

    // ---------------------------------------------------------------- dépôt
    const videoBytes = await fs.readFile(generated.outputPath);
    const storagePath = `${project.user_id}/${projectId}.mp4`;

    const { error: uploadError } = await supabase.storage
      .from("generated-videos")
      .upload(storagePath, videoBytes, {
        contentType: "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Dépôt de la vidéo impossible : ${uploadError.message}`);
    }

    const { data: publicUrl } = supabase.storage
      .from("generated-videos")
      .getPublicUrl(storagePath);

    // Les plans conservent l'URL de leur clip : un plan raté pourra être
    // régénéré seul, sans refaire toute la publicité.
    const shotsWithClips = analysis.analysis.shots.map((shot, index) => {
      const done = generated.shots.find((s) => s.index === index);
      return { ...shot, videoUrl: done?.videoUrl ?? null, requestId: done?.requestId ?? null };
    });

    // Un plan raté ne fait pas échouer la publicité — mais l'utilisateur doit
    // le savoir : sa vidéo est plus courte que prévu.
    const partial =
      generated.failed.length > 0
        ? `${generated.failed.length} plan(s) sur ${analysis.analysis.shots.length} n'ont pas pu être générés : ${generated.failed
            .map((f) => `plan ${f.index + 1} (${f.message})`)
            .join(" · ")}`
        : null;

    await update({
      status: "completed",
      generated_video_url: publicUrl.publicUrl,
      shots: shotsWithClips,
      generation_credits: Math.round(generated.shots.length * 6.5),
      error_message: partial,
    });

    await generated.cleanup();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Tracé AVANT toute tentative d'écriture : si la base est justement ce qui
    // ne répond plus, c'est la seule trace qui subsistera.
    console.error(`[projet ${projectId}] ÉCHEC : ${message}`);

    // Le contenu refusé mérite son propre statut : ce n'est pas une panne, et
    // le message à afficher n'est pas le même.
    const status = /nsfw/i.test(message) ? "nsfw" : "failed";

    await supabase
      .from("projects")
      .update({ status, error_message: message.slice(0, 1000) })
      .eq("id", projectId);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
