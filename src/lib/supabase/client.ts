import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase pour le NAVIGATEUR.
 *
 * À utiliser dans les composants marqués `"use client"` : formulaires de
 * connexion, boutons, etc. La session est stockée dans des cookies, ce qui
 * permet au serveur de la lire aussi (voir `server.ts` et `proxy.ts`).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
