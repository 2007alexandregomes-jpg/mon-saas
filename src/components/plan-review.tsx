"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TREATMENT_HELP,
  TREATMENT_LABELS,
  type PlannedShot,
  type ShotTreatment,
} from "@/lib/types";

/**
 * L'écran de validation du plan.
 *
 * Le tri automatique n'est pas stable : d'une analyse à l'autre, le même plan
 * peut être édité, fabriqué ou écarté. Plutôt que de subir cette variabilité,
 * on la montre — le client voit chaque plan, le traitement proposé, la raison,
 * et peut corriger avant que le moindre centime soit dépensé.
 */

/** Facturation du modèle d'édition : 0,168 $ la seconde, minimum 3 s, max 10 s. */
function editCost(durationSeconds: number) {
  return Math.max(3, Math.min(durationSeconds, 10)) * 0.168;
}

const TREATMENTS: ShotTreatment[] = ["edit", "still", "card", "drop"];

const BADGES: Record<ShotTreatment, string> = {
  edit: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  still: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  card: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  drop: "bg-neutral-100 text-neutral-500 dark:bg-white/10 dark:text-neutral-400",
};

export function PlanReview({
  projectId,
  initialShots,
  brandName,
}: {
  projectId: string;
  initialShots: PlannedShot[];
  brandName: string | null;
}) {
  const router = useRouter();
  const [shots, setShots] = useState(initialShots);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kept = shots.filter((s) => s.treatment !== "drop");
  const edits = kept.filter((s) => s.treatment === "edit");
  const total = edits.reduce((sum, s) => sum + editCost(s.durationSeconds), 0);
  const duration = kept.reduce((sum, s) => sum + s.durationSeconds, 0);

  function setTreatment(index: number, treatment: ShotTreatment) {
    setShots((current) =>
      current.map((s) => (s.index === index ? { ...s, treatment } : s)),
    );
  }

  async function launch() {
    setLaunching(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Lancement impossible.");
        setLaunching(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Le serveur n'a pas répondu.");
      setLaunching(false);
    }
  }

  return (
    <section className="rounded-xl border border-amber-500/30 bg-amber-50/50 p-5 dark:bg-amber-950/10">
      <h2 className="text-lg font-medium">Valide le plan avant de lancer</h2>
      <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
        Voici chaque plan de la publicité d&apos;origine et ce qu&apos;on propose
        d&apos;en faire. Tu peux tout changer — <strong>rien n&apos;est facturé
        tant que tu n&apos;as pas lancé</strong>.
      </p>

      <ol className="mt-6 space-y-3">
        {shots.map((shot) => (
          <li
            key={shot.index}
            className={`flex gap-4 rounded-lg border p-3 transition ${
              shot.treatment === "drop"
                ? "border-black/10 opacity-50 dark:border-white/10"
                : "border-black/15 bg-white dark:border-white/20 dark:bg-white/5"
            }`}
          >
            <div className="relative h-28 w-16 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-white/10">
              <Image
                src={shot.thumbUrl}
                alt={`Plan ${shot.index + 1}`}
                fill
                sizes="64px"
                className="object-cover"
                unoptimized
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-neutral-500">
                  Plan {shot.index + 1} · {shot.durationSeconds.toFixed(1)} s
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGES[shot.treatment]}`}
                >
                  {TREATMENT_LABELS[shot.treatment]}
                </span>
                {shot.treatment === "edit" && (
                  <span className="text-xs tabular-nums text-neutral-500">
                    {editCost(shot.durationSeconds).toFixed(2)} $
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-sm">{shot.content}</p>
              <p className="mt-0.5 text-xs text-neutral-500">{shot.reason}</p>

              {shot.overlaidText && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  ✂️ Marque du concurrent repérée : « {shot.overlaidText} »
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {TREATMENTS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    title={TREATMENT_HELP[t]}
                    onClick={() => setTreatment(shot.index, t)}
                    disabled={t === "card" && !brandName}
                    className={`rounded-md px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      shot.treatment === t
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                    }`}
                  >
                    {TREATMENT_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-lg border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-white/5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm">Vidéo finale</span>
          <span className="text-sm tabular-nums">
            {duration.toFixed(1)} s · {kept.length} plans
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between">
          <span className="text-sm">
            {edits.length} édition{edits.length > 1 ? "s" : ""} vidéo
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {total.toFixed(2)} $
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Les autres plans sont fabriqués sur place, sans coût.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-600/30 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={launch}
        disabled={launching || kept.length === 0}
        className="mt-4 w-full rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        {launching
          ? "Lancement…"
          : kept.length === 0
            ? "Tous les plans sont retirés"
            : `Lancer la fabrication — ${total.toFixed(2)} $`}
      </button>

      <p className="mt-2 text-center text-xs text-neutral-500">
        Environ 6 minutes. Tu peux fermer la page.
      </p>
    </section>
  );
}
