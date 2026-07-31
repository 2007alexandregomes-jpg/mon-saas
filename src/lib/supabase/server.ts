import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase pour le SERVEUR (Server Components, Server Actions,
 * Route Handlers).
 *
 * Il lit la session dans les cookies de la requête en cours. Comme un nouveau
 * client est créé à chaque appel, il ne faut jamais le stocker dans une
 * variable globale.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Next.js interdit d'écrire un cookie depuis un Server Component.
            // On peut ignorer : c'est `proxy.ts` qui rafraîchit la session.
          }
        },
      },
    },
  );
}
