"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import {
  ACCEPT_ATTRIBUTE,
  removeProductImage,
  uploadProductImage,
  validateImage,
  type UploadedImage,
} from "@/lib/storage/product-images";

/**
 * Dépôt des photos produit.
 *
 * Chaque photo est téléversée dès qu'elle est choisie, pas à l'envoi du
 * formulaire : l'utilisateur voit tout de suite si ça passe, et la création du
 * projet est instantanée.
 */

const MAX_PHOTOS = 8;

export function PhotoUploader({
  userId,
  images,
  onChange,
}: {
  userId: string;
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const room = MAX_PHOTOS - images.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) {
      setError(`Maximum ${MAX_PHOTOS} photos — les suivantes ont été ignorées.`);
    }

    // Accumulateur local : les photos partent l'une après l'autre, et une
    // capture figée de `images` perdrait les précédentes à chaque tour.
    let accumulated = images;

    for (const file of chosen) {
      const problem = validateImage(file);
      if (problem) {
        setError(problem);
        continue;
      }

      setUploading((n) => n + 1);
      try {
        const uploaded = await uploadProductImage(file, userId);
        accumulated = [...accumulated, uploaded];
        onChange(accumulated);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Dépôt impossible.",
        );
      } finally {
        setUploading((n) => n - 1);
      }
    }

    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRemove(image: UploadedImage) {
    onChange(images.filter((i) => i.path !== image.path));
    await removeProductImage(image.path).catch(() => {
      // L'image restera dans le bucket : sans gravité, elle n'est référencée
      // nulle part. On ne bloque pas l'utilisateur pour ça.
    });
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        Photos du produit <span className="text-red-500">*</span>
      </label>
      <p className="mb-3 text-xs text-neutral-500">
        3 à 6 photos avec des <strong>cadrages différents</strong> — face,
        trois-quarts, macro, packaging. Chaque plan de la vidéo partira de la
        photo la plus adaptée.
      </p>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {images.map((image) => (
          <div
            key={image.path}
            className="group relative aspect-square overflow-hidden rounded-lg border border-black/10 bg-neutral-50 dark:border-white/15 dark:bg-white/5"
          >
            <Image
              src={image.url}
              alt=""
              fill
              sizes="120px"
              className="object-contain"
              unoptimized
            />
            <button
              type="button"
              onClick={() => handleRemove(image)}
              aria-label="Retirer cette photo"
              className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}

        {images.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading > 0}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-black/20 text-xs text-neutral-500 transition hover:border-black/40 hover:bg-black/5 disabled:opacity-50 dark:border-white/25 dark:hover:border-white/50 dark:hover:bg-white/5"
          >
            {uploading > 0 ? (
              <>Envoi…</>
            ) : (
              <>
                <span className="text-lg">+</span>
                Ajouter
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {images.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          {images.length} photo{images.length > 1 ? "s" : ""} prête
          {images.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
