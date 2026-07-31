import { STATUS_LABELS, type Project, type ProjectStatus } from "@/lib/types";

const STATUS_CLASSES: Record<ProjectStatus, string> = {
  pending:
    "bg-neutral-100 text-neutral-700 dark:bg-white/10 dark:text-neutral-300",
  analyzing: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  generating:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  nsfw: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  canceled:
    "bg-neutral-100 text-neutral-500 dark:bg-white/5 dark:text-neutral-400",
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function ProjectList({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-black/15 p-10 text-center dark:border-white/20">
        <p className="text-sm text-neutral-500">
          Aucun projet pour l&apos;instant. Crée le premier avec le formulaire
          ci-contre.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {projects.map((project) => (
        <li
          key={project.id}
          className="rounded-xl border border-black/10 p-4 dark:border-white/15"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium">{project.product_name}</h3>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[project.status]}`}
            >
              {STATUS_LABELS[project.status]}
            </span>
          </div>

          {project.product_description && (
            <p className="mt-2 line-clamp-2 text-sm text-neutral-500">
              {project.product_description}
            </p>
          )}

          <p className="mt-3 truncate text-xs text-neutral-400">
            Réf.{" "}
            {/* `rel` protège l'onglet d'origine : sans lui, le site ouvert
                pourrait manipuler ta page via window.opener. */}
            <a
              href={project.competitor_video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-neutral-600"
            >
              {project.competitor_video_url}
            </a>
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <time
              dateTime={project.created_at}
              className="text-xs text-neutral-400"
            >
              {dateFormatter.format(new Date(project.created_at))}
            </time>

            {project.generated_video_url && (
              <a
                href={project.generated_video_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium underline underline-offset-2"
              >
                Voir la vidéo
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
