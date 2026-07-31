import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Analyse une vidéo publicitaire concurrente et réécrit son script pour le
 * produit du client.
 *
 * Claude ne lit pas les vidéos : on lui envoie des images extraites, plus le
 * titre et la description récupérés par yt-dlp. Six images bien réparties
 * suffisent à décrire le cadrage, les mouvements et le texte à l'écran.
 */

/**
 * Le format exact de la réponse. Claude est contraint de le respecter — pas
 * de JSON approximatif à rattraper avec des expressions régulières.
 */
const AnalysisSchema = z.object({
  style: z.object({
    camera: z.string().describe("Mouvements et angles de caméra observés"),
    lighting: z.string().describe("Éclairage, palette de couleurs, ambiance"),
    pacing: z.string().describe("Rythme : durée des plans, coupes, énergie"),
    setting: z.string().describe("Décor, arrière-plan, mise en scène du produit"),
  }),
  originalScript: z.object({
    hook: z.string().describe("L'accroche des 3 premières secondes"),
    body: z.string().describe("L'argumentaire central"),
    cta: z.string().describe("L'appel à l'action final"),
  }),
  adaptedScript: z.object({
    hook: z.string().describe("Accroche réécrite pour le produit du client"),
    body: z.string().describe("Argumentaire réécrit pour le produit du client"),
    cta: z.string().describe("Appel à l'action réécrit"),
  }),
  higgsfieldPrompt: z
    .string()
    .describe(
      "Prompt en ANGLAIS décrivant le mouvement de caméra et le style à appliquer à l'image du produit. Pas de dialogue, pas de texte à l'écran — uniquement le visuel et le mouvement.",
    ),
  notes: z
    .string()
    .describe("Ce qui rend cette publicité efficace, en une ou deux phrases"),
});

export type VideoAnalysis = z.infer<typeof AnalysisSchema>;

const SYSTEM_PROMPT = `Tu es directeur créatif spécialisé en publicité vidéo courte (TikTok, Reels, Shorts).

On te donne des images extraites d'une publicité qui fonctionne, et les informations d'un autre produit. Ton travail :

Les images te sont données dans l'ordre chronologique, à cadence régulière : leur numéro te dit où tu en es dans la vidéo. Utilise-les pour suivre le déroulé, pas seulement pour juger l'esthétique.

1. Décrire précisément le style visuel : mouvements de caméra, éclairage, rythme, mise en scène.
2. Reconstituer la structure du script (accroche, argumentaire, appel à l'action) en croisant TROIS sources : la transcription de ce qui est dit, le texte incrusté à l'écran, et le titre/description. Cite le phrasé réel de l'accroche — c'est ce qui fait s'arrêter le pouce.
3. Réécrire ce script pour le produit du client — même structure et même énergie, mais un contenu qui lui est propre. Jamais de copie mot à mot, jamais de mention de la marque concurrente.
4. Rédiger un prompt en anglais pour un modèle image-to-video, décrivant uniquement le mouvement de caméra et le rendu visuel à appliquer à la photo du produit.

Écris les scripts en français, dans le ton de la vidéo de référence. Sois concret : "travelling avant lent sur le produit posé sur un plan de travail en marbre, lumière rasante dorée" plutôt que "belle esthétique".

Si les images ne permettent pas de conclure sur un point, dis-le franchement plutôt que d'inventer.`;

export type AnalyzeInput = {
  /** Les images extraites, encodées en base64, dans l'ordre chronologique. */
  frames: string[];
  /** Métadonnées récupérées par yt-dlp — souvent riches en texte du script. */
  video: {
    title: string | null;
    description: string | null;
    durationSeconds: number | null;
    /** Le texte parlé : sous-titres de la plateforme ou transcription. */
    transcript: string | null;
  };
  product: {
    name: string;
    description: string | null;
  };
};

export async function analyzeVideo({
  frames,
  video,
  product,
}: AnalyzeInput): Promise<VideoAnalysis> {
  if (frames.length === 0) {
    throw new Error("Aucune image à analyser.");
  }

  // La clé est lue depuis l'environnement serveur — jamais exposée au navigateur.
  const client = new Anthropic();

  const context = [
    "VIDÉO DE RÉFÉRENCE",
    `Durée : ${video.durationSeconds ? `${Math.round(video.durationSeconds)} s` : "inconnue"}`,
    `Images fournies : ${frames.length}, réparties dans l'ordre chronologique.`,
    video.title ? `Titre : ${video.title}` : null,
    video.description ? `Description : ${video.description}` : null,
    video.transcript
      ? `\nCE QUI EST DIT À L'ORAL (transcription) :\n${video.transcript}`
      : "\nAucune transcription disponible : reconstitue le script à partir du texte visible à l'écran, du titre et de la description, et signale-le dans `notes`.",
    "",
    "PRODUIT DU CLIENT",
    `Nom : ${product.name}`,
    product.description ? `Description : ${product.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(AnalysisSchema) },
    messages: [
      {
        role: "user",
        content: [
          ...frames.map((data, index) => [
            {
              type: "text" as const,
              text: `Image ${index + 1} sur ${frames.length} :`,
            },
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data,
              },
            },
          ]).flat(),
          { type: "text", text: context },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      "L'analyse a été refusée pour cette vidéo. Essaie avec une autre publicité.",
    );
  }

  if (!response.parsed_output) {
    throw new Error("L'analyse n'a pas renvoyé de résultat exploitable.");
  }

  return response.parsed_output;
}
