import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          La pub vidéo de ton concurrent, avec ton produit
        </h1>
        <p className="mt-5 text-pretty text-neutral-500">
          Colle le lien d&apos;une vidéo qui marche, ajoute les infos de ton
          produit, et récupère une vidéo qui en reprend le style et les
          mouvements.
        </p>

        <div className="mt-9 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Commencer
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-black/15 px-5 py-2.5 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Se connecter
          </Link>
        </div>
      </div>
    </main>
  );
}
