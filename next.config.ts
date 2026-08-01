import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Ces paquets ne contiennent pas du code à empaqueter : ils pointent vers un
   * EXÉCUTABLE présent sur le disque, dont ils calculent le chemin à partir de
   * leur propre emplacement.
   *
   * Empaquetés par Next.js, ce calcul donne `/ROOT/node_modules/…` — un chemin
   * qui n'existe nulle part, d'où « Impossible de lancer ffmpeg ». Les déclarer
   * externes les laisse être chargés normalement depuis node_modules.
   */
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],

  images: {
    remotePatterns: [
      // Les photos produit déposées dans Supabase Storage.
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/**" },
    ],
  },
};

export default nextConfig;
