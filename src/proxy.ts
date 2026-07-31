import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Le « proxy » (ex-middleware) tourne AVANT chaque page. Il a deux rôles :
 *
 *  1. Rafraîchir le jeton de session Supabase quand il expire, et réécrire les
 *     cookies. Sans ça, l'utilisateur serait déconnecté au bout d'une heure.
 *  2. Protéger les routes : /dashboard exige d'être connecté, et un utilisateur
 *     déjà connecté n'a rien à faire sur /login ou /signup.
 */

/** Routes accessibles uniquement quand on est connecté. */
const PROTECTED_ROUTES = ["/dashboard"];

/** Routes réservées aux visiteurs non connectés. */
const AUTH_ROUTES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  // Réponse par défaut : « laisse passer la requête telle quelle ».
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Les cookies rafraîchis doivent être posés à la fois sur la requête
          // (pour la suite du rendu) et sur la réponse (pour le navigateur).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT : `getUser()` et pas `getSession()`. getUser() revalide le jeton
  // auprès de Supabase ; getSession() se contente de lire un cookie que
  // n'importe qui pourrait falsifier.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isAuthRoute = AUTH_ROUTES.includes(pathname);

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    // On mémorise où l'utilisateur voulait aller pour l'y renvoyer après login.
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isAuthRoute) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  // Toujours renvoyer `response` : c'est elle qui porte les cookies rafraîchis.
  return response;
}

export const config = {
  matcher: [
    /*
     * Tout sauf :
     * - les fichiers internes de Next.js (_next/static, _next/image)
     * - le favicon et les images statiques
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
