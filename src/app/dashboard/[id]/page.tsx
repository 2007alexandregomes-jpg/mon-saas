import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ProjectProgress } from "@/components/project-progress";
import { STATUS_LABELS, type Project } from "@/lib/types";

export const metadata: Metadata = { title: "Projet" };

/** Le traitement écrit en base en continu : cette page ne se met jamais en cache. */
export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-0.5 text-sm">{value}</p>
    </div>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Le RLS garantit qu'on ne peut lire que ses propres projets : un identifiant
  // deviné renvoie « introuvable », pas le projet de quelqu'un d'autre.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single<Project>();

  if (!project) notFound();

  const shots = project.shots ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
      <Link
        href="/dashboard"
        className="text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-800 dark:hover:text-neutral-200"
      >
        ← Tous mes projets
      </Link>

      <header className="mt-6 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {project.product_name}
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          {STATUS_LABELS[project.status]} ·{" "}
          {dateFormatter.format(new Date(project.created_at))}
        </p>
      </header>

      <div className="space-y-6">
        <ProjectProgress project={project} />

        {project.generated_video_url && (
          <Section title="Ta publicité">
            <video
              src={project.generated_video_url}
              controls
              playsInline
              className="w-full rounded-lg bg-black"
            />
            <a
              href={project.generated_video_url}
              download={`${project.product_name}.mp4`}
              className="mt-4 inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Télécharger la vidéo
            </a>
            <p className="mt-3 text-xs text-neutral-500">
              La vidéo est muette : choisis ton son directement dans TikTok au
              moment de publier — un son tendance porte bien mieux qu&apos;une
              musique importée.
            </p>
          </Section>
        )}

        {project.adapted_script && (
          <Section title="Script adapté à ton produit">
            <Field label="Accroche" value={project.adapted_script.hook} />
            <Field label="Corps" value={project.adapted_script.body} />
            <Field label="Conclusion" value={project.adapted_script.cta} />
          </Section>
        )}

        {shots.length > 0 && (
          <Section title={`Découpage — ${shots.length} plans`}>
            <ol className="space-y-4">
              {shots.map((shot, index) => (
                <li
                  key={index}
                  className="border-l-2 border-black/10 pl-4 dark:border-white/15"
                >
                  <p className="text-xs font-medium text-neutral-500">
                    Plan {index + 1} · {shot.durationSeconds} s
                  </p>
                  <p className="mt-0.5 text-sm">{shot.description}</p>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {project.style && (
          <Section title="Style repris de la référence">
            <Field label="Caméra" value={project.style.camera} />
            <Field label="Lumière" value={project.style.lighting} />
            <Field label="Rythme" value={project.style.pacing} />
            <Field label="Décor" value={project.style.setting} />
          </Section>
        )}

        <Section title="Références">
          <Field
            label="Produit"
            value={project.product_description ?? "(aucune description)"}
          />
          <div className="mb-3">
            <p className="text-xs font-medium text-neutral-500">
              Vidéo concurrente
            </p>
            <a
              href={project.competitor_video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block truncate text-sm underline underline-offset-2"
            >
              {project.competitor_video_url}
            </a>
          </div>
          {project.analysis_cost_usd !== null && (
            <p className="mt-4 border-t border-black/10 pt-3 text-xs text-neutral-500 dark:border-white/10">
              Coût : {project.analysis_cost_usd.toFixed(2)} $ d&apos;analyse
              {project.generation_credits
                ? ` · ${project.generation_credits} crédits de génération`
                : ""}
            </p>
          )}
        </Section>
      </div>
    </main>
  );
}
