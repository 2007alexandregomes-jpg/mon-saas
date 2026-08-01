import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ImageMediaType, ProductImage } from "./analyze-video";

/**
 * Décide, plan par plan, comment remplacer le produit du concurrent.
 *
 * Trois traitements existent, et ils n'ont ni le même coût ni le même usage.
 * C'est Claude qui aiguille, en regardant les images de chaque plan :
 *
 *  - `edit`  : le vêtement est porté ou mis en scène → édition vidéo (~0,50 $)
 *  - `still` : gros plan sur la matière → zoom sur la photo du client (0 $)
 *  - `card`  : carton de marque du concurrent → carton du client (0 $)
 *  - `drop`  : plan inexploitable → retiré du montage
 *
 * La priorité est la FIDÉLITÉ à la publicité d'origine, pas l'économie. Un
 * plan fabriqué localement à partir d'une photo de studio ne partage ni le
 * décor, ni la lumière, ni le grain de la vidéo : inséré au milieu d'un film
 * tourné dehors, il se voit immédiatement. Il n'est donc acceptable que sur un
 * macro de pure matière, où aucun décor n'est reconnaissable.
 */

const TREATMENTS = ["edit", "still", "card", "drop"] as const;

const PlanSchema = z.object({
  shots: z.array(
    z.object({
      index: z.number().int().describe("Numéro du plan, tel qu'il t'est donné"),
      content: z
        .string()
        .describe("En FRANÇAIS : ce qu'on voit dans ce plan, en une phrase"),
      overlaidText: z
        .string()
        .describe(
          "Le texte, logo ou filigrane visible en surimpression dans ce plan, tel que tu le lis. " +
            "Chaîne VIDE s'il n'y en a pas. Sert à demander explicitement son effacement.",
        ),
      treatment: z
        .enum(TREATMENTS)
        .describe(
          "edit = le produit est porté ou mis en scène, il faut l'édition vidéo ; " +
            "still = gros plan sur la matière, un zoom sur la photo suffit ; " +
            "card = carton de marque ou texte du concurrent ; " +
            "drop = plan inexploitable ou sans rapport",
        ),
      editPrompt: z
        .string()
        .describe(
          "Si treatment = edit : la consigne en ANGLAIS pour le modèle d'édition. " +
            "Chaîne VIDE sinon.",
        ),
      sourceImageIndex: z
        .number()
        .int()
        .describe(
          "Si treatment = still : index (à partir de 0) de la photo produit à utiliser. 0 sinon.",
        ),
      cropHint: z
        .string()
        .describe(
          "Si treatment = still : quelle partie du produit cadrer (« la maille », " +
            "« le col », « les boutons »). Chaîne VIDE sinon.",
        ),
      reason: z
        .string()
        .describe("En FRANÇAIS : pourquoi ce traitement, en une phrase courte"),
    }),
  ),
  productDescription: z
    .string()
    .describe(
      "En ANGLAIS : description précise du produit du client d'après ses photos — " +
        "matière, couleur exacte, coupe, col, manches, détails. Sera réutilisée dans chaque consigne d'édition.",
    ),
});

export type ShotPlan = z.infer<typeof PlanSchema>;
export type ShotTreatment = (typeof TREATMENTS)[number];

const SYSTEM_PROMPT = `Tu es monteur vidéo, spécialisé dans l'adaptation de publicités.

On te donne les plans d'une publicité existante, et les photos du produit d'un autre client. L'objectif : produire la MÊME publicité, au même rythme et dans le même décor, mais avec le produit du client à la place de celui d'origine.

Tu ne réinventes rien. Tu décides seulement, pour chaque plan, COMMENT y faire apparaître le produit du client.

QUATRE TRAITEMENTS

- \`edit\` — C'EST LE TRAITEMENT PAR DÉFAUT. Dès que le plan montre une personne, un décor identifiable, un mouvement de caméra dans une scène, ou le produit mis en situation, c'est \`edit\`. Il coûte de l'argent, et ce n'est pas un critère : la fidélité à la publicité d'origine passe avant l'économie.

- \`still\` — RÉSERVÉ aux macros de pure matière. Trois conditions doivent être réunies, sans exception :
    1. le tissu remplit tout le cadre,
    2. aucun décor n'est reconnaissable — ni ciel, ni feuillage, ni mur, ni sol, ni main, ni visage,
    3. il ne se passe rien d'autre qu'un léger mouvement sur la matière.
  Au moindre doute, choisis \`edit\`. Un plan fabriqué à partir d'une photo de studio n'a ni la lumière, ni le fond, ni le grain de la vidéo : glissé dans une publicité tournée dehors, il saute aux yeux et ruine la copie. Ne l'utilise que là où il n'y a littéralement rien d'autre à voir que du tissu.

- \`card\` — carton-titre, logo, texte plein cadre appartenant au concurrent. À remplacer par celui du client. On ne peut évidemment pas conserver la marque d'un concurrent dans une publicité.

- \`drop\` — plan qui ne montre pas le produit et n'apporte rien, ou image composite de plusieurs panneaux (le modèle d'édition n'en traite qu'un seul et rate les autres).

TEXTES ET LOGOS INCRUSTÉS — point crucial

Beaucoup de plans portent en surimpression le nom, le logo ou un slogan du concurrent. Les laisser reviendrait à diffuser sa marque dans la publicité du client : c'est inacceptable.

Quand tu vois du texte, un logo ou un filigrane dans un plan, DIS-LE explicitement dans la consigne d'édition : « Remove the overlaid text and logo completely, leaving only the clean background. » Nomme le texte que tu vois, pour que le modèle sache quoi effacer.

Si un plan n'est QUE du texte ou un logo plein cadre, ce n'est pas une édition : c'est un \`card\`.

RÉDACTION DES CONSIGNES D'ÉDITION (en anglais)

Sois précis et concret. Décris le produit du client tel que tu le vois sur les photos, puis exige que TOUT LE RESTE soit conservé : angle de caméra, cadrage, pose, décor, lumière, durée. Termine par « Do not add any cut. »

Ne nomme jamais une couleur par un lieu ou un objet : « forest green » fait apparaître une forêt. Écris « dark desaturated green ».`;

export type PlanShotsInput = {
  /** Une entrée par plan : ses images, dans l'ordre chronologique. */
  shots: { index: number; durationSeconds: number; frames: ProductImage[] }[];
  /** Les photos du produit du client. */
  productImages: ProductImage[];
  product: { name: string; description: string | null };
  /** Le client veut-il que les personnes soient remplacées ? */
  replacePeople: boolean;
  /** Que faire des cartons de marque : les remplacer, ou les retirer. */
  brandCards: { mode: "replace" | "drop"; text?: string };
};

export async function planShots({
  shots,
  productImages,
  product,
  replacePeople,
  brandCards,
}: PlanShotsInput): Promise<{ plan: ShotPlan; costUsd: number }> {
  const client = new Anthropic();

  const content: Anthropic.ContentBlockParam[] = [];

  content.push({
    type: "text",
    text: `PRODUIT DU CLIENT\nNom : ${product.name}${
      product.description ? `\nDescription : ${product.description}` : ""
    }\n\nSes ${productImages.length} photo(s) suivent.`,
  });

  productImages.forEach((image, i) => {
    content.push({ type: "text", text: `Photo produit ${i} :` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data },
    });
  });

  content.push({
    type: "text",
    text:
      `\nLA PUBLICITÉ À ADAPTER — ${shots.length} plans.\n` +
      (replacePeople
        ? "Le client veut que les PERSONNES soient elles aussi remplacées par d'autres.\n"
        : "Les personnes doivent rester identiques ; seul le produit change.\n") +
      (brandCards.mode === "replace"
        ? `Les cartons de marque du concurrent seront remplacés par : « ${brandCards.text ?? product.name} ».\n`
        : "Les cartons de marque du concurrent doivent être retirés (treatment = drop).\n"),
  });

  for (const shot of shots) {
    content.push({
      type: "text",
      text: `\nPlan ${shot.index} — ${shot.durationSeconds.toFixed(2)} s :`,
    });
    for (const frame of shot.frames) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: frame.mediaType,
          data: frame.data,
        },
      });
    }
  }

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(PlanSchema) },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("L'analyse a été refusée pour cette publicité.");
  }
  if (!response.parsed_output) {
    throw new Error("L'analyse n'a pas renvoyé de résultat exploitable.");
  }

  const inputTokens =
    response.usage.input_tokens +
    (response.usage.cache_read_input_tokens ?? 0) +
    (response.usage.cache_creation_input_tokens ?? 0);

  return {
    plan: response.parsed_output,
    // Tarifs Claude Opus 5 : 5 $ / 25 $ par million de tokens.
    costUsd:
      (inputTokens / 1_000_000) * 5 +
      (response.usage.output_tokens / 1_000_000) * 25,
  };
}

export type { ImageMediaType };
