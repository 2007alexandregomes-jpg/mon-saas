/** Les statuts autorisés par la contrainte `check` de la table projects. */
export type ProjectStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "analyzing"
  | "generating"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: "En attente",
  planning: "Analyse de la publicité",
  awaiting_approval: "En attente de ta validation",
  analyzing: "Analyse de la référence",
  generating: "Fabrication de la vidéo",
  completed: "Terminé",
  failed: "Échec",
  nsfw: "Contenu refusé",
  canceled: "Annulé",
};

/** Le traitement retenu pour un plan. */
export type ShotTreatment = "edit" | "still" | "card" | "drop";

export const TREATMENT_LABELS: Record<ShotTreatment, string> = {
  edit: "Édition vidéo",
  still: "Zoom sur photo",
  card: "Carton de marque",
  drop: "Retirer du montage",
};

export const TREATMENT_HELP: Record<ShotTreatment, string> = {
  edit: "Le produit est remplacé dans la scène d'origine. Seul traitement payant.",
  still: "Un lent zoom sur ta photo. Gratuit, mais sans le décor de la vidéo.",
  card: "Un carton avec ton nom de marque, sur fond uni. Gratuit.",
  drop: "Ce plan disparaît de la vidéo finale.",
};

export type VideoFormat = { width: number; height: number };

/** Un plan de la publicité d'origine, et ce qu'on prévoit d'en faire. */
export type PlannedShot = {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  /** L'extrait d'origine, déposé publiquement pour le modèle d'édition. */
  clipUrl: string;
  /** Une vignette, pour que le client voie de quel plan on parle. */
  thumbUrl: string;
  /** Ce que Claude a vu dans ce plan. */
  content: string;
  /** Pourquoi ce traitement a été proposé. */
  reason: string;
  /** Le texte du concurrent repéré dans ce plan. */
  overlaidText: string;
  treatment: ShotTreatment;
  editPrompt: string;
  sourceImageIndex: number;
  cropHint: string;
  /** Rempli après exécution. */
  resultUrl: string | null;
  error: string | null;
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

  // Ce que le client choisit au départ
  brand_name: string | null;
  replace_people: boolean;

  // Le plan proposé, qu'il valide avant toute dépense
  shot_plan: PlannedShot[] | null;
  source_format: VideoFormat | null;
  plan_cost_usd: number | null;
  edit_cost_usd: number | null;

  // Résultat final
  generated_video_url: string | null;

  // Traçabilité des coûts
  analysis_cost_usd: number | null;
  generation_credits: number | null;

  created_at: string;
  updated_at: string;
};
