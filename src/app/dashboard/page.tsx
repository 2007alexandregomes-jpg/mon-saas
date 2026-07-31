import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { NewProjectForm } from "@/components/new-project-form";
import { ProjectList } from "@/components/project-list";
import type { Project } from "@/lib/types";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `proxy.ts` bloque déjà les visiteurs non connectés. On revérifie ici :
  // c'est la ceinture en plus des bretelles, et ça rassure TypeScript sur le
  // fait que `user` n'est pas null en dessous.
  if (!user) redirect("/login");

  // Pas de `.eq("user_id", user.id)` : le RLS filtre déjà côté Postgres.
  // On ne peut PAS recevoir les projets de quelqu'un d'autre, même par erreur.
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  const projects = data ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Connecté en tant que <strong>{user.email}</strong>
          </p>
        </div>

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-black/15 px-3 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Déconnexion
          </button>
        </form>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="text-lg font-medium">Nouveau projet</h2>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            Colle la pub à imiter et décris ton produit.
          </p>
          <NewProjectForm />
        </section>

        <section>
          <h2 className="text-lg font-medium">
            Mes projets{" "}
            <span className="text-neutral-400">({projects.length})</span>
          </h2>
          <p className="mt-1 mb-6 text-sm text-neutral-500">
            Du plus récent au plus ancien.
          </p>

          {error ? (
            <p className="rounded-lg border border-red-600/30 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
              Impossible de charger tes projets : {error.message}
            </p>
          ) : (
            <ProjectList projects={projects} />
          )}
        </section>
      </div>
    </main>
  );
}
