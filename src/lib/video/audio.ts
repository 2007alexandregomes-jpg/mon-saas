import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { run } from "./run";

/**
 * Extrait la piste audio en MP3 mono 16 kHz.
 *
 * C'est le format attendu par tous les services de transcription : mono parce
 * qu'une voix n'a pas besoin de stéréo, 16 kHz parce que c'est la fréquence
 * sur laquelle les modèles de reconnaissance vocale sont entraînés. Un fichier
 * dix fois plus léger transcrit aussi bien, et se téléverse dix fois plus vite.
 */
export async function extractAudio(videoPath: string): Promise<string> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg est introuvable (paquet ffmpeg-static absent ?).");
  }

  const audioPath = path.join(path.dirname(videoPath), "audio.mp3");

  await run(
    ffmpegPath,
    [
      "-i",
      videoPath,
      "-vn", // pas de vidéo
      "-ac",
      "1", // mono
      "-ar",
      "16000", // 16 kHz
      "-b:a",
      "64k",
      "-y",
      audioPath,
    ],
    { timeoutMs: 120_000 },
  );

  return audioPath;
}

/** Vrai si la vidéo contient une piste audio exploitable. */
export async function hasAudioTrack(videoPath: string): Promise<boolean> {
  const ffprobe = (await import("ffprobe-static")).default;

  try {
    const { stdout } = await run(
      ffprobe.path,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        videoPath,
      ],
      { timeoutMs: 30_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
