import { downloadVideo } from "@/lib/video/download";
import { extractFrames, frameToBase64 } from "@/lib/video/frames";
import { extractAudio, hasAudioTrack } from "@/lib/video/audio";
import { transcribeAudio } from "@/lib/ai/transcribe";
import {
  analyzeVideo,
  type AnalysisUsage,
  type ProductImage,
  type VideoAnalysis,
} from "@/lib/ai/analyze-video";

/**
 * Le pipeline complet : d'un lien TikTok à un script réécrit.
 *
 *   1. Télécharger la vidéo (+ titre, description, sous-titres)
 *   2. Obtenir le texte parlé — sous-titres si la plateforme les fournit,
 *      transcription Groq sinon
 *   3. Extraire les images
 *   4. Envoyer le tout à Claude
 *   5. Nettoyer les fichiers temporaires, quoi qu'il arrive
 *
 * Chaque résultat intermédiaire est émis DÈS QU'IL EXISTE via `onEvent`, sans
 * attendre la fin : l'interface peut afficher le titre de la vidéo au bout de
 * 30 secondes plutôt qu'une barre de chargement muette pendant deux minutes.
 */

export type VideoMeta = {
  title: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  /** Dimensions de la référence : la pub générée doit les reproduire. */
  width: number | null;
  height: number | null;
};

export type TranscriptSource = "sous-titres" | "transcription" | "aucun";

/**
 * Ce que le pipeline raconte pendant qu'il travaille.
 *
 * Chaque étape émet `start` puis `done`. Les `done` transportent le résultat,
 * ce qui permet de l'afficher immédiatement.
 */
export type PipelineEvent =
  | { step: "téléchargement"; status: "start" }
  | { step: "téléchargement"; status: "done"; video: VideoMeta }
  | { step: "texte parlé"; status: "start" }
  | {
      step: "texte parlé";
      status: "done";
      source: TranscriptSource;
      transcript: string | null;
    }
  | { step: "images"; status: "start" }
  | { step: "images"; status: "done"; count: number }
  | { step: "analyse"; status: "start" }
  | {
      step: "analyse";
      status: "done";
      analysis: VideoAnalysis;
      usage: AnalysisUsage;
    };

export type PipelineResult = {
  analysis: VideoAnalysis;
  usage: AnalysisUsage;
  transcriptSource: TranscriptSource;
  frameCount: number;
  video: VideoMeta;
};

export async function analyzeCompetitorVideo({
  url,
  product,
  options,
  onEvent,
}: {
  url: string;
  /** `images` : les photos du produit en base64, vues par Claude. */
  product: { name: string; description: string | null; images?: ProductImage[] };
  /** `forceVoiceover` : le client veut une voix off même si la référence est muette. */
  options?: { forceVoiceover?: boolean };
  onEvent?: (event: PipelineEvent) => void;
}): Promise<PipelineResult> {
  onEvent?.({ step: "téléchargement", status: "start" });
  const video = await downloadVideo(url);

  const videoMeta: VideoMeta = {
    title: video.title,
    durationSeconds: video.durationSeconds,
    uploader: video.uploader,
    width: video.width,
    height: video.height,
  };
  onEvent?.({ step: "téléchargement", status: "done", video: videoMeta });

  try {
    // --- Le texte parlé ---
    onEvent?.({ step: "texte parlé", status: "start" });

    let transcript = video.subtitles;
    let transcriptSource: TranscriptSource = transcript ? "sous-titres" : "aucun";

    if (!transcript && (await hasAudioTrack(video.filePath))) {
      try {
        const audioPath = await extractAudio(video.filePath);
        const text = await transcribeAudio(audioPath);
        if (text.length > 0) {
          transcript = text;
          transcriptSource = "transcription";
        }
      } catch (error) {
        // Une transcription ratée ne doit pas faire échouer toute l'analyse :
        // Claude sait travailler à partir du texte à l'écran, en moins bien.
        console.warn("Transcription échouée, on continue sans :", error);
      }
    }

    onEvent?.({
      step: "texte parlé",
      status: "done",
      source: transcriptSource,
      transcript,
    });

    // --- Les images ---
    onEvent?.({ step: "images", status: "start" });
    const framePaths = await extractFrames(video.filePath, {
      durationSeconds: video.durationSeconds,
    });
    const frames = await Promise.all(framePaths.map(frameToBase64));
    onEvent?.({ step: "images", status: "done", count: frames.length });

    // --- L'analyse ---
    onEvent?.({ step: "analyse", status: "start" });
    const { analysis, usage } = await analyzeVideo({
      frames,
      video: {
        title: video.title,
        description: video.description,
        durationSeconds: video.durationSeconds,
        transcript,
      },
      product,
      options,
    });
    onEvent?.({ step: "analyse", status: "done", analysis, usage });

    return {
      analysis,
      usage,
      transcriptSource,
      frameCount: frames.length,
      video: videoMeta,
    };
  } finally {
    // `finally` : les fichiers temporaires partent même si l'analyse plante.
    await video.cleanup();
  }
}
