/** Les 4 valeurs autorisées par la contrainte `check` de la table projects. */
export type ProjectStatus = "pending" | "processing" | "completed" | "failed";

/** Une ligne de la table `projects`. Reflète exactement supabase/schema.sql. */
export type Project = {
  id: string;
  user_id: string;
  competitor_video_url: string;
  product_name: string;
  product_description: string | null;
  product_image_url: string | null;
  status: ProjectStatus;
  generated_video_url: string | null;
  created_at: string;
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pending: "En attente",
  processing: "Génération en cours",
  completed: "Terminé",
  failed: "Échec",
};
