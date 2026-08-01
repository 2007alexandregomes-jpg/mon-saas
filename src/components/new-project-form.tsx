"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createProject, type CreateProjectState } from "@/app/dashboard/actions";
import { PhotoUploader } from "@/components/photo-uploader";
import type { UploadedImage } from "@/lib/storage/product-images";

const inputClass =
  "w-full rounded-lg border border-black/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50";

/**
 * Le bouton doit connaître l'état d'envoi du formulaire parent.
 * `useFormStatus` ne marche que dans un composant ENFANT du <form>, d'où
 * ce petit composant séparé.
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      {pending ? "Création…" : "Analyser cette publicité"}
    </button>
  );
}

export function NewProjectForm({ userId }: { userId: string }) {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [state, formAction] = useActionState<CreateProjectState, FormData>(
    createProject,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
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
          La pub dont tu veux reprendre le style, le rythme et le découpage. Ta
          vidéo aura exactement le même format.
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
          placeholder="JBL Tune 770NC"
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
          placeholder="Casque circum-auriculaire noir mat, réduction de bruit active, 70 h d'autonomie, pour les 18-35 ans qui prennent les transports"
          className={`${inputClass} resize-y`}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Matière, format, bénéfice concret, cible. Plus c&apos;est précis, meilleur
          sera le script.
        </p>
      </div>

      <PhotoUploader userId={userId} images={images} onChange={setImages} />

      {/* Les URL des photos voyagent en JSON : elles sont déjà dans le bucket. */}
      <input
        type="hidden"
        name="product_image_urls"
        value={JSON.stringify(images.map((i) => i.url))}
      />

      <div>
        <label htmlFor="brand_name" className="mb-1.5 block text-sm font-medium">
          Nom de ta marque
        </label>
        <input
          id="brand_name"
          name="brand_name"
          type="text"
          maxLength={60}
          placeholder="anouck aimé"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Remplace les cartons de marque du concurrent. Laissé vide, ces plans
          seront simplement retirés.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/15">
        <input
          type="checkbox"
          name="replace_people"
          defaultChecked
          className="mt-0.5 h-4 w-4 accent-neutral-900 dark:accent-white"
        />
        <span>
          Remplacer aussi les personnes filmées
          <span className="mt-0.5 block text-xs text-neutral-500">
            Une autre personne portera ton produit, dans la même pose et le même
            décor.
          </span>
        </span>
      </label>

      {state.error && (
        <p className="rounded-lg border border-red-600/30 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {state.error}
        </p>
      )}

      <SubmitButton disabled={images.length === 0} />

      <p className="text-center text-xs text-neutral-500">
        L&apos;analyse prend ~2 minutes et ne coûte presque rien. Tu verras le
        plan et le devis <strong>avant</strong> de lancer la fabrication.
      </p>
    </form>
  );
}
