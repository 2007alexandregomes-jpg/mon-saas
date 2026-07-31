import Link from "next/link";
import type { Metadata } from "next";
import { SignupForm } from "@/components/signup-form";
import { GoogleButton } from "@/components/google-button";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirectTo?.startsWith("/")
    ? params.redirectTo
    : "/dashboard";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Créer un compte
        </h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Génère tes vidéos publicitaires en quelques minutes.
        </p>

        <div className="mt-8">
          <GoogleButton redirectTo={redirectTo} />
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
          ou
          <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
        </div>

        <SignupForm redirectTo={redirectTo} />

        <p className="mt-6 text-center text-sm text-neutral-500">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium underline">
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
