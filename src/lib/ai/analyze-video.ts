import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Analyse une vidéo publicitaire concurrente et réécrit son script pour le
 * produit du client.
 *
 * Claude ne lit pas les vidéos : on lui envoie des images extraites, le texte
 * parlé (sous-titres ou transcription), plus le titre et la description.
 */

/**
 * Le format exact de la réponse. Claude est contraint de le respecter — pas
 * de JSON approximatif à rattraper avec des expressions régulières.
 */
const AnalysisSchema = z.object({
  /**
   * Constat AVANT réécriture : par quels canaux la référence fait-elle passer
   * son message ? C'est ce constat qui détermine la forme de l'adaptation.
   */
  referenceFormat: z.object({
    hasSpokenScript: z
      .boolean()
      .describe("true si quelqu'un parle dans la vidéo de référence"),
    hasOnScreenText: z
      .boolean()
      .describe("true s'il y a du texte incrusté à l'écran"),
    summary: z
      .string()
      .describe(
        "En une phrase : par quels moyens la vidéo transmet son message (image seule, voix off, texte incrusté, musique…)",
      ),
  }),
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
    hook: z.string().describe("Accroche adaptée au produit du client"),
    body: z.string().describe("Partie centrale adaptée au produit du client"),
    cta: z.string().describe("Conclusion adaptée au produit du client"),
  }),
  /**
   * La signature visuelle commune à tous les plans, en anglais.
   *
   * Elle est préfixée à chaque prompt de plan : c'est ce qui empêche les
   * clips générés séparément de ressembler à cinq publicités différentes.
   */
  visualSignature: z
    .string()
    .describe(
      "En ANGLAIS, une phrase décrivant le rendu commun à TOUS les plans : type de rendu, palette, éclairage, ambiance. Sera préfixée à chaque prompt de plan pour garantir la cohérence.",
    ),
  /**
   * Le découpage plan par plan.
   *
   * Higgsfield génère un mouvement continu par appel : un plan = une
   * génération. C'est ce découpage qui permet d'obtenir une vraie publicité
   * montée plutôt qu'un seul mouvement confus.
   */
  shots: z.array(
    z.object({
      durationSeconds: z
        .number()
        .int()
        .describe("Durée de ce plan en secondes (entre 3 et 8)"),
      description: z
        .string()
        .describe("En FRANÇAIS : ce que le client verra à l'écran sur ce plan"),
      referenceImage: z
        .string()
        .describe(
          "En ANGLAIS : l'image FIXE de départ de ce plan — cadrage, angle, distance, position du produit, fond, éclairage. C'est le point de départ que l'animation va faire bouger. Chaque plan a le sien : un gros plan macro ne part pas de la même image qu'un plan large.",
        ),
      motionPrompt: z
        .string()
        .describe(
          "En ANGLAIS : UNIQUEMENT le mouvement à appliquer à cette image de départ — déplacement de caméra, rotation du produit, effets. Un seul mouvement continu, sans coupe. Pas de dialogue, pas de texte à l'écran.",
        ),
    }),
  ),
  notes: z
    .string()
    .describe("Ce qui rend cette publicité efficace, en une ou deux phrases"),
});

export type VideoAnalysis = z.infer<typeof AnalysisSchema>;

export type AnalysisUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Coût estimé en dollars, aux tarifs Claude Opus 5. */
  costUsd: number;
};

/** Tarifs Claude Opus 5, en dollars par million de tokens. */
const PRICE_PER_MTOK = { input: 5, output: 25 };

const BASE_PROMPT = `Tu es directeur créatif spécialisé en publicité vidéo courte (TikTok, Reels, Shorts).

On te donne des images extraites d'une publicité qui fonctionne, le texte parlé quand il existe, et les informations d'un autre produit.

Les images te sont données dans l'ordre chronologique, à cadence régulière : leur numéro te dit où tu en es dans la vidéo. Utilise-les pour suivre le déroulé, pas seulement pour juger l'esthétique.

Ton travail :

1. CONSTATER la forme de la référence : y a-t-il quelqu'un qui parle ? du texte incrusté ? ou l'image et la musique portent-elles seules le message ? Remplis \`referenceFormat\` en premier, honnêtement.
2. Décrire précisément le style visuel : mouvements de caméra, éclairage, rythme, mise en scène.
3. Reconstituer la structure de la référence (accroche, partie centrale, conclusion) en croisant TROIS sources : la transcription, le texte incrusté, le titre/description. Cite le phrasé réel de l'accroche quand il existe — c'est ce qui fait s'arrêter le pouce.
4. Adapter cette structure au produit du client.
5. Découper l'adaptation en PLANS pour la génération vidéo (voir ci-dessous).

DÉCOUPAGE EN PLANS — point technique important

La vidéo finale sera fabriquée plan par plan : un modèle image-to-video anime UNE image fixe en UN mouvement continu, sans coupe. Un plan = une génération.

Produis entre 3 et 6 plans, dont les durées additionnées correspondent à la durée de la référence. Pour chaque plan :

- \`referenceImage\` décrit l'IMAGE FIXE de départ : cadrage, angle, distance, position du produit dans le cadre, fond, éclairage. Chaque plan a la sienne, et elles doivent être NETTEMENT différentes les unes des autres — un gros plan macro sur une texture ne part pas de la même image qu'un plan large en lévitation. C'est ce qui donnera un vrai montage plutôt que cinq variantes du même cadrage.
- \`motionPrompt\` décrit UNIQUEMENT ce qui bouge à partir de cette image : déplacement de caméra, rotation, effets. Un seul mouvement, aucune coupe, aucun changement de lieu.
- \`visualSignature\` (au niveau racine) contient ce qui est COMMUN à tous les plans : type de rendu, palette, éclairage général. Ne le répète pas dans chaque plan.

Écris \`referenceImage\`, \`motionPrompt\` et \`visualSignature\` en anglais. \`description\` en français.

Écris en français, dans le ton de la vidéo de référence. Sois concret : "travelling avant lent sur le produit posé sur un plan de travail en marbre, lumière rasante dorée" plutôt que "belle esthétique".

Si les images ne permettent pas de conclure sur un point, dis-le franchement plutôt que d'inventer.`;

/** Règle par défaut : l'adaptation reproduit la forme de la référence. */
const MATCH_FORM_RULE = `
RÈGLE ABSOLUE SUR LA FORME DE L'ADAPTATION

\`adaptedScript\` doit utiliser EXACTEMENT les mêmes canaux que la référence. Tu ne changes pas le format, tu changes le produit.

- Si \`hasSpokenScript\` est false : n'invente AUCUNE voix off, AUCUN dialogue, AUCUNE réplique. Les trois champs décrivent alors ce qu'on VOIT et ce qu'on ENTEND (musique, ambiance), plan par plan. Écris "Plan 1 : …" et non une phrase à prononcer.
- Si \`hasOnScreenText\` est false : n'ajoute aucun texte incrusté.
- Si la référence parle : écris les répliques, avec le même registre et la même longueur.

Une publicité muette qui fonctionne, fonctionne PARCE QU'elle est muette. Y ajouter une voix off, c'est en changer la nature — et ce n'est pas ce qu'on te demande.`;

/** Variante quand le client demande explicitement une voix off. */
const FORCE_VOICEOVER_RULE = `
FORME DE L'ADAPTATION

Le client demande explicitement une voix off, même si la référence n'en a pas.

Reprends le rythme, le découpage et l'ambiance de la référence, et écris par-dessus un script parlé : une phrase courte par plan, calée sur les temps du montage. Reste sobre — la voix accompagne l'image, elle ne la commente pas.`;

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
  options?: {
    /**
     * `false` (défaut) : l'adaptation reproduit la forme de la référence —
     * muette si la référence est muette.
     * `true` : le client veut une voix off quoi qu'il arrive.
     */
    forceVoiceover?: boolean;
  };
};

export async function analyzeVideo({
  frames,
  video,
  product,
  options,
}: AnalyzeInput): Promise<{ analysis: VideoAnalysis; usage: AnalysisUsage }> {
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
      ? `\nBANDE SON / TEXTE PARLÉ (transcription automatique) :\n${video.transcript}\n\nAttention : cette transcription peut ne contenir que des paroles de musique. Des paroles de chanson ne sont PAS un script publicitaire — dans ce cas \`hasSpokenScript\` reste false.`
      : "\nAucune transcription disponible : reconstitue la structure à partir du texte visible à l'écran, du titre et de la description, et signale-le dans `notes`.",
    "",
    "PRODUIT DU CLIENT",
    `Nom : ${product.name}`,
    product.description ? `Description : ${product.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const system =
    BASE_PROMPT +
    "\n" +
    (options?.forceVoiceover ? FORCE_VOICEOVER_RULE : MATCH_FORM_RULE);

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system,
    output_config: { format: zodOutputFormat(AnalysisSchema) },
    messages: [
      {
        role: "user",
        content: [
          ...frames
            .map((data, index) => [
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
            ])
            .flat(),
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

  const inputTokens =
    response.usage.input_tokens +
    (response.usage.cache_read_input_tokens ?? 0) +
    (response.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = response.usage.output_tokens;

  return {
    analysis: response.parsed_output,
    usage: {
      inputTokens,
      outputTokens,
      costUsd:
        (inputTokens / 1_000_000) * PRICE_PER_MTOK.input +
        (outputTokens / 1_000_000) * PRICE_PER_MTOK.output,
    },
  };
}
