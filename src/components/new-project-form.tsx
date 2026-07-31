"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createProject, type CreateProjectState } from "@/app/dashboard/actions";

const inputClass =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

/**
 * Le bouton doit connaître l'état d'envoi du formulaire parent.
 * `useFormStatus` ne marche que dans un composant ENFANT du <form>, d'où
 * ce petit composant séparé.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? "Création…" : "Créer le projet"}
    </button>
  );
}

export function NewProjectForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<CreateProjectState, FormData>(
    createProject,
    {},
  );

  // Après un succès, on vide les champs pour enchaîner sur un autre projet.
  useEffect(() => {
    if (state.successId) formRef.current?.reset();
  }, [state.successId]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div>
        <label
          htmlFor="competitor_video_url"
          className="mb-1.5 block text-sm font-medium"
        >
          Vidéo concurrente <span className="text-red-500">*</span>
        </label>
        <input
          id="competitor_video_url"
          name="competitor_video_url"
          type="url"
          required
          placeholder="https://www.tiktok.com/@marque/video/123456"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          La pub dont tu veux reprendre le style et les mouvements.
        </p>
      </div>

      <div>
        <label
          htmlFor="product_name"
          className="mb-1.5 block text-sm font-medium"
        >
          Nom du produit <span className="text-red-500">*</span>
        </label>
        <input
          id="product_name"
          name="product_name"
          type="text"
          required
          maxLength={200}
          placeholder="Crème hydratante bio"
          className={inputClass}
        />
      </div>

      <div>
        <label
          htmlFor="product_description"
          className="mb-1.5 block text-sm font-medium"
        >
          Description
        </label>
        <textarea
          id="product_description"
          name="product_description"
          rows={3}
          placeholder="Matière, bénéfices, ambiance souhaitée…"
          className={`${inputClass} resize-y`}
        />
      </div>

      <div>
        <label
          htmlFor="product_image_url"
          className="mb-1.5 block text-sm font-medium"
        >
          Image du produit <span className="text-neutral-400">(URL)</span>
        </label>
        <input
          id="product_image_url"
          name="product_image_url"
          type="url"
          placeholder="https://mon-site.com/produit.jpg"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Le lien direct vers une image déjà en ligne — depuis ta fiche produit,
          par exemple.
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-600/30 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {state.error}
        </p>
      )}

      {state.successId && !state.error && (
        <p className="rounded-lg border border-green-600/30 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-400">
          Projet créé ✅
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
