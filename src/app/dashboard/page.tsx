import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

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

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
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

      <div className="mt-10 rounded-xl border border-dashed border-black/15 p-10 text-center dark:border-white/20">
        <p className="text-sm text-neutral-500">
          Rien ici pour l&apos;instant. C&apos;est là qu&apos;on ajoutera la
          création de projets vidéo.
        </p>
      </div>
    </main>
  );
}
