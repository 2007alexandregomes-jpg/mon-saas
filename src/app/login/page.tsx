import Link from "next/link";
import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { GoogleButton } from "@/components/google-button";

export const metadata: Metadata = { title: "Connexion" };

/**
 * Page /login.
 *
 * Depuis Next.js 15, `searchParams` est une Promise : il faut l'attendre.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirectTo?.startsWith("/")
    ? params.redirectTo
    : "/dashboard";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Connexion</h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Content de te revoir.
        </p>

        {params.error && (
          <p className="mt-6 rounded-lg border border-red-600/30 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
            {params.error}
          </p>
        )}

        <div className="mt-8">
          <GoogleButton redirectTo={redirectTo} />
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
          ou
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
        </div>

        <LoginForm redirectTo={redirectTo} />

        <p className="mt-6 text-center text-sm text-neutral-500">
          Pas encore de compte ?{" "}
          <Link href="/signup" className="font-medium underline">
            Créer un compte
          </Link>
        </p>
      </div>
    </main>
  );
}
