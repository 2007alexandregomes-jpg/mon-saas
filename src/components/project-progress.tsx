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

/** Statuts où plus rien ne tourne : inutile de continuer à interroger la base. */
const TERMINAL: ProjectStatus[] = [
  "completed",
  "failed",
  "nsfw",
  "canceled",
  // La validation attend une action humaine, pas la fin d'un traitement.
  "awaiting_approval",
];

/** Les étapes visibles par l'utilisateur, dans l'ordre. */
const STEPS: { status: ProjectStatus; label: string; detail: string }[] = [
  {
    status: "planning",
    label: "Analyse de la publicite",
    detail: "Telechargement, decoupage en plans, choix des traitements",
  },
  {
    status: "awaiting_approval",
    label: "Validation du plan",
    detail: "Tu verifies et tu lances — rien n'est facture avant",
  },
  {
    status: "generating",
    label: "Fabrication de la video",
    detail: "Les plans sont produits en parallele, puis montes",
  },
  {
    status: "completed",
    label: "Termine",
    detail: "Ta publicite est prete",
  },
];

const ORDER: ProjectStatus[] = [
  "pending",
  "planning",
  "awaiting_approval",
  "generating",
  "completed",
];

export function ProjectProgress({ project }: { project: Project }) {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);
  const triggered = useRef(false);

  // 1. Démarrer le traitement si personne ne l'a fait.
  useEffect(() => {
    if (project.status !== "pending" || triggered.current) return;
    triggered.current = true;

    fetch(`/api/projects/${project.id}/plan`, { method: "POST" }).catch(() => {
      // Le prochain rafraichissement de la page reessaiera.
    });
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

  // Pendant la validation, l’ecran de plan prend le relais.
  if (status === "completed" || status === "awaiting_approval") return null;

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
            await fetch(`/api/projects/${project.id}/plan`, { method: "POST" });
            setStatus("planning");
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

      {/* Filet de sécurité : le montage se termine sur le disque avant d'être
          déposé. Si le dépôt échoue, la vidéo existe mais le projet reste
          marqué « en cours » — ce bouton va la chercher. */}
      <div className="mt-3">
        <button
          type="button"
          disabled={recovering}
          onClick={async () => {
            setRecovering(true);
            setRecoverMessage(null);
            try {
              const response = await fetch(
                `/api/projects/${project.id}/recover`,
                { method: "POST" },
              );
              const body = await response.json();
              if (!response.ok) {
                setRecoverMessage(body.error ?? "Récupération impossible.");
              } else {
                setStatus("completed");
                router.refresh();
              }
            } catch {
              setRecoverMessage("Le serveur n'a pas répondu.");
            } finally {
              setRecovering(false);
            }
          }}
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800 disabled:opacity-50 dark:hover:text-neutral-200"
        >
          {recovering ? "Recherche…" : "Ça semble bloqué ? Récupérer la vidéo"}
        </button>
        {recoverMessage && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {recoverMessage}
          </p>
        )}
      </div>
    </div>
  );
}
