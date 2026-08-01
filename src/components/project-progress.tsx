"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { retryProject } from "@/app/dashboard/actions";
import { STATUS_LABELS, type Project, type ProjectStatus } from "@/lib/types";

/**
 * Suit l'avancement d'un projet et déclenche son traitement.
 *
 * Deux rôles :
 *  1. Au premier affichage, si le projet est en attente, demander au serveur
 *     de commencer. La route répond immédiatement, le travail continue seul.
 *  2. Interroger la base toutes les 3 secondes jusqu'à ce que ce soit fini.
 *
 * Interroger plutôt qu'écouter en temps réel : c'est plus simple, ça survit à
 * une coupure réseau, et 3 secondes de latence sur un traitement de 8 minutes
 * ne se remarquent pas.
 */

const POLL_MS = 3_000;

const TERMINAL: ProjectStatus[] = ["completed", "failed", "nsfw", "canceled"];

/** Les étapes visibles par l'utilisateur, dans l'ordre. */
const STEPS: { status: ProjectStatus; label: string; detail: string }[] = [
  {
    status: "analyzing",
    label: "Analyse de la référence",
    detail: "Téléchargement, transcription, découpage en plans",
  },
  {
    status: "generating",
    label: "Génération de la vidéo",
    detail: "Tous les plans sont fabriqués en parallèle",
  },
  {
    status: "completed",
    label: "Montage terminé",
    detail: "Ta publicité est prête",
  },
];

const ORDER: ProjectStatus[] = ["pending", "analyzing", "generating", "completed"];

export function ProjectProgress({ project }: { project: Project }) {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const triggered = useRef(false);

  // 1. Démarrer le traitement si personne ne l'a fait.
  useEffect(() => {
    if (project.status !== "pending" || triggered.current) return;
    triggered.current = true;

    fetch(`/api/projects/${project.id}/process`, { method: "POST" }).catch(
      () => {
        // Le prochain rafraîchissement de la page réessaiera.
      },
    );
  }, [project.id, project.status]);

  // 2. Interroger la base jusqu'à un statut définitif.
  useEffect(() => {
    if (TERMINAL.includes(status)) return;

    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("projects")
        .select("status")
        .eq("id", project.id)
        .single<{ status: ProjectStatus }>();

      if (data && data.status !== status) {
        setStatus(data.status);
        // Recharge les données serveur : l'analyse, les plans et la vidéo
        // apparaissent alors sans que l'utilisateur ait à faire quoi que ce soit.
        router.refresh();
      }
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [project.id, status, router]);

  // 3. Un chronomètre, pour que l'attente ne paraisse pas figée.
  useEffect(() => {
    if (TERMINAL.includes(status)) return;
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [status, startedAt]);

  if (status === "completed") return null;

  if (status === "failed" || status === "nsfw" || status === "canceled") {
    return (
      <div className="rounded-xl border border-red-600/30 bg-red-50 p-5 dark:bg-red-950/20">
        <p className="font-medium text-red-800 dark:text-red-300">
          {status === "nsfw"
            ? "Contenu refusé par le générateur"
            : "La génération a échoué"}
        </p>
        <p className="mt-1.5 text-sm text-red-700 dark:text-red-400">
          {project.error_message ?? "Aucun détail disponible."}
        </p>

        {retryError && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-400">
            {retryError}
          </p>
        )}

        <button
          type="button"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            setRetryError(null);
            const result = await retryProject(project.id);
            if (result.error) {
              setRetryError(result.error);
              setRetrying(false);
              return;
            }
            // Le projet est de nouveau « en attente » : on relance le
            // traitement et on repasse l'affichage en mode avancement.
            await fetch(`/api/projects/${project.id}/process`, { method: "POST" });
            setStatus("analyzing");
            setRetrying(false);
            router.refresh();
          }}
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {retrying ? "Relancement…" : "Relancer"}
        </button>

        <p className="mt-3 text-xs text-red-700/70 dark:text-red-400/70">
          Rien n&apos;est resaisi : le lien, le produit et les photos sont
          conservés.
        </p>
      </div>
    );
  }

  const currentIndex = ORDER.indexOf(status);

  return (
    <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
      <div className="mb-5 flex items-baseline justify-between">
        <p className="font-medium">{STATUS_LABELS[status]}</p>
        <p className="text-sm tabular-nums text-neutral-500">
          {Math.floor(elapsed / 60)} min {String(elapsed % 60).padStart(2, "0")} s
        </p>
      </div>

      <ol className="space-y-4">
        {STEPS.map((step) => {
          const index = ORDER.indexOf(step.status);
          const done = currentIndex > index;
          const active = currentIndex === index;

          return (
            <li key={step.status} className="flex gap-3">
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  done
                    ? "bg-green-600 text-white"
                    : active
                      ? "animate-pulse bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "border border-black/20 text-neutral-400 dark:border-white/25"
                }`}
              >
                {done ? "✓" : ""}
              </span>
              <div>
                <p
                  className={`text-sm ${active ? "font-medium" : done ? "" : "text-neutral-400"}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-neutral-500">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 border-t border-black/10 pt-4 text-xs text-neutral-500 dark:border-white/10">
        Environ 8 minutes au total. <strong>Tu peux fermer cette page</strong> —
        le travail continue sur nos serveurs, tu retrouveras ta vidéo ici.
      </p>
    </div>
  );
}
