import { downloadVideo } from "@/lib/video/download";
import { extractFrames, frameToBase64 } from "@/lib/video/frames";
import { extractAudio, hasAudioTrack } from "@/lib/video/audio";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { analyzeVideo, type VideoAnalysis } from "@/lib/ai/analyze-video";

/**
 * Le pipeline complet : d'un lien TikTok à un script réécrit.
 *
 *   1. Télécharger la vidéo (+ titre, description, sous-titres)
 *   2. Obtenir le texte parlé — sous-titres si la plateforme les fournit,
 *      transcription Groq sinon
 *   3. Extraire les images
 *   4. Envoyer le tout à Claude
 *   5. Nettoyer les fichiers temporaires, quoi qu'il arrive
 */

export type PipelineResult = {
  analysis: VideoAnalysis;
  /** Comment on a obtenu le texte parlé — utile pour diagnostiquer. */
  transcriptSource: "sous-titres" | "transcription" | "aucun";
  frameCount: number;
  video: {
    title: string | null;
    durationSeconds: number | null;
    uploader: string | null;
  };
};

export type ProgressStep =
  | "téléchargement"
  | "transcription"
  | "extraction des images"
  | "analyse";

export async function analyzeCompetitorVideo({
  url,
  product,
  onProgress,
}: {
  url: string;
  product: { name: string; description: string | null };
  onProgress?: (step: ProgressStep) => void;
}): Promise<PipelineResult> {
  onProgress?.("téléchargement");
  const video = await downloadVideo(url);

  try {
    // --- Le texte parlé ---
    let transcript = video.subtitles;
    let transcriptSource: PipelineResult["transcriptSource"] = transcript
      ? "sous-titres"
      : "aucun";

    if (!transcript && (await hasAudioTrack(video.filePath))) {
      onProgress?.("transcription");
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

    // --- Les images ---
    onProgress?.("extraction des images");
    const framePaths = await extractFrames(video.filePath, {
      durationSeconds: video.durationSeconds,
    });
    const frames = await Promise.all(framePaths.map(frameToBase64));

    // --- L'analyse ---
    onProgress?.("analyse");
    const analysis = await analyzeVideo({
      frames,
      video: {
        title: video.title,
        description: video.description,
        durationSeconds: video.durationSeconds,
        transcript,
      },
      product,
    });

    return {
      analysis,
      transcriptSource,
      frameCount: frames.length,
      video: {
        title: video.title,
        durationSeconds: video.durationSeconds,
        uploader: video.uploader,
      },
    };
  } finally {
    // `finally` : les fichiers temporaires partent même si l'analyse plante.
    await video.cleanup();
  }
}
