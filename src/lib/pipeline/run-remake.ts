import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { planProject } from "@/lib/pipeline/plan-project";
import { executePlan, planCost } from "@/lib/pipeline/execute-plan";
import type { ImageMediaType, ProductImage } from "@/lib/ai/analyze-video";
import type { PlannedShot, Project, VideoFormat } from "@/lib/types";

/**
 * Les deux étapes du traitement, branchées sur la base de données.
 *
 * Elles tournent DÉTACHÉES de la requête HTTP : chacune dure plusieurs minutes.
 * Elles écrivent leur avancement en base, et c'est la page du projet qui le lit.
 *
 * Conséquence : aucune exception ne doit s'en échapper sans avoir été écrite en
 * base, sinon le projet resterait bloqué sans explication.
 */

/**
 * Client Supabase utilisable après la fin de la requête.
 *
 * La clé de service n'expire pas, contrairement au jeton d'un utilisateur — un
 * traitement de dix minutes lui survit, et ses dernières écritures échoueraient.
 * En contrepartie elle contourne les politiques d'accès : le code filtre donc
 * lui-même, le chemin de dépôt venant du `user_id` lu sur le projet.
 */
function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : les traitements longs ne peuvent pas aboutir.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Devine le format d'après les premiers octets, jamais d'après l'extension. */
function detectMediaType(buffer: Buffer): ImageMediaType {
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return "image/jpeg";
}

async function fetchProductImages(urls: string[], workDir: string) {
  const images: ProductImage[] = [];
  const paths: string[] = [];

  for (const [index, url] of urls.entries()) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`Photo inaccessible (HTTP ${response.status}) : ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const mediaType = detectMediaType(buffer);

    images.push({ data: buffer.toString("base64"), mediaType });

    const localPath = path.join(workDir, `photo-${index}.jpg`);
    await fs.writeFile(localPath, buffer);
    paths.push(localPath);
  }

  return { images, paths };
}

/** Écrit en base et LÈVE si l'écriture échoue — sinon l'échec passerait inaperçu. */
async function makeUpdater(supabase: SupabaseClient, projectId: string) {
  return async (patch: Partial<Project>) => {
    const { error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", projectId);
    if (error) {
      console.error(
        `[projet ${projectId}] écriture refusée (${Object.keys(patch).join(", ")}) : ${error.message}`,
      );
      throw new Error(`Écriture en base impossible : ${error.message}`);
    }
  };
}

async function loadProject(supabase: SupabaseClient, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single<Project>();
  if (error || !data) throw new Error("Projet introuvable.");
  return data;
}

/** Marque le projet en échec, en traçant AVANT d'écrire. */
async function recordFailure(
  supabase: SupabaseClient,
  projectId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[projet ${projectId}] ÉCHEC : ${message}`);
  const status = /nsfw/i.test(message) ? "nsfw" : "failed";
  await supabase
    .from("projects")
    .update({ status, error_message: message.slice(0, 1000) })
    .eq("id", projectId);
}

// ---------------------------------------------------------------- étape ①

export async function runPlanning(projectId: string) {
  const supabase = serviceClient();
  const update = await makeUpdater(supabase, projectId);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-"));

  try {
    const project = await loadProject(supabase, projectId);
    const { images } = await fetchProductImages(
      project.product_image_urls,
      workDir,
    );

    const result = await planProject({
      url: project.competitor_video_url,
      product: {
        name: project.product_name,
        description: project.product_description,
      },
      productImages: images,
      options: {
        replacePeople: project.replace_people,
        brandCards: project.brand_name
          ? { mode: "replace", text: project.brand_name }
          : { mode: "drop" },
      },
      uploadPublic: async (filePath, key, contentType) => {
        const bucket = contentType.startsWith("video")
          ? "generated-videos"
          : "product-images";
        const storagePath = `${project.user_id}/${projectId}/${key}`;
        const { error } = await supabase.storage
          .from(bucket)
          .upload(storagePath, await fs.readFile(filePath), {
            contentType,
            upsert: true,
          });
        if (error) throw new Error(`Dépôt impossible : ${error.message}`);
        return supabase.storage.from(bucket).getPublicUrl(storagePath).data
          .publicUrl;
      },
      onEvent: (step) => console.log(`[projet ${projectId}] ${step}`),
    });

    await update({
      status: "awaiting_approval",
      shot_plan: result.shots,
      source_format: result.format,
      visual_signature: result.productDescription,
      plan_cost_usd: Number(result.costUsd.toFixed(4)),
      edit_cost_usd: Number(planCost(result.shots).toFixed(4)),
      error_message: null,
    });
  } catch (error) {
    await recordFailure(supabase, projectId, error);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- étape ②

export async function runExecution(projectId: string) {
  const supabase = serviceClient();
  const update = await makeUpdater(supabase, projectId);
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-"));

  try {
    const project = await loadProject(supabase, projectId);
    if (!project.shot_plan || !project.source_format) {
      throw new Error("Aucun plan validé à exécuter.");
    }

    const { paths } = await fetchProductImages(
      project.product_image_urls,
      workDir,
    );

    const result = await executePlan({
      shots: project.shot_plan as PlannedShot[],
      format: project.source_format as VideoFormat,
      productDescription: project.visual_signature ?? project.product_name,
      productImageUrls: project.product_image_urls,
      productImagePaths: paths,
      brandName: project.brand_name,
      onEvent: (event) =>
        console.log(`[projet ${projectId}] ${JSON.stringify(event)}`),
    });

    const videoBytes = await fs.readFile(result.outputPath);
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

    const publicUrl = supabase.storage
      .from("generated-videos")
      .getPublicUrl(storagePath).data.publicUrl;

    await update({
      status: "completed",
      generated_video_url: publicUrl,
      shot_plan: result.shots,
      edit_cost_usd: Number(result.editCostUsd.toFixed(4)),
      error_message:
        result.failed > 0
          ? `${result.failed} plan(s) n'ont pas pu être produits — la vidéo est plus courte que prévu.`
          : null,
    });

    await result.cleanup();
  } catch (error) {
    await recordFailure(supabase, projectId, error);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
