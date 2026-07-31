import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Point d'atterrissage après une connexion Google, ou après un clic sur le
 * lien de confirmation reçu par email.
 *
 * Supabase nous renvoie ici avec un `?code=...` à usage unique, qu'on échange
 * contre une vraie session (posée dans les cookies).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  // On n'accepte qu'une redirection interne, sinon un attaquant pourrait
  // fabriquer un lien qui renvoie vers son propre site après connexion.
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Lien de connexion invalide.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${safeRedirect}`);
}
