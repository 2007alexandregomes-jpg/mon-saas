/** Les statuts autorisés par la contrainte `check` de la table projects. */
export type ProjectStatus =
  | "pending"
  | "analyzing"
  | "generating"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: "En attente",
  analyzing: "Analyse de la référence",
  generating: "Génération de la vidéo",
  completed: "Terminé",
  failed: "Échec",
  nsfw: "Contenu refusé",
  canceled: "Annulé",
};

/** Un plan de la vidéo finale. Un plan = une génération Higgsfield. */
export type Shot = {
  durationSeconds: number;
  /** En français, pour le client. */
  description: string;
  /** En anglais : l'image fixe de départ voulue pour ce plan. */
  referenceImage: string;
  /** En anglais : le mouvement à appliquer à cette image. */
  motionPrompt: string;
  /** Index de la photo produit à utiliser comme départ. */
  sourceImageIndex: number;
  /** Rempli après génération. */
  videoUrl?: string | null;
  /** Identifiant de la requête Higgsfield, pour suivre l'avancement. */
  requestId?: string | null;
};

/** Une ligne de la table `projects`. Reflète supabase/migrations/*.sql. */
export type Project = {
  id: string;
  user_id: string;

  // Ce que l'utilisateur fournit
  competitor_video_url: string;
  product_name: string;
  product_description: string | null;
  product_image_urls: string[];

  // Avancement
  status: ProjectStatus;
  error_message: string | null;

  // Résultat de l'analyse
  reference_transcript: string | null;
  reference_format: {
    hasSpokenScript: boolean;
    hasOnScreenText: boolean;
    summary: string;
  } | null;
  style: {
    camera: string;
    lighting: string;
    pacing: string;
    setting: string;
  } | null;
  original_script: { hook: string; body: string; cta: string } | null;
  adapted_script: { hook: string; body: string; cta: string } | null;
  visual_signature: string | null;
  shots: Shot[] | null;
  notes: string | null;

  // Résultat final
  generated_video_url: string | null;

  // Traçabilité des coûts
  analysis_cost_usd: number | null;
  generation_credits: number | null;

  created_at: string;
  updated_at: string;
};
