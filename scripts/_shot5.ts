import { generateShot } from "../src/lib/higgsfield/generate-shot";
import { downloadClip } from "../src/lib/video/assemble";
import { uploadImage } from "../src/lib/higgsfield/upload";
import fs from "node:fs";

const DIR = "/private/var/folders/kj/pkz2j81d1ksgpz1_840y9c580000gn/T/hf-generate-QhWmAE";
const PREP = "/private/var/folders/kj/pkz2j81d1ksgpz1_840y9c580000gn/T/hf-prepare-jEkgZz";

async function main() {
  const saved = JSON.parse(fs.readFileSync("analyse-jbl.json", "utf8"));
  const shot = saved.analysis.shots[4];
  console.log(`Plan 5 — photo #${shot.sourceImageIndex}, ${shot.durationSeconds}s`);

  const url = await uploadImage(`${PREP}/jbl-${shot.sourceImageIndex}-1282x720.png`);
  console.log("image téléversée");

  const r = await generateShot({
    imageUrl: url,
    visualSignature: saved.analysis.visualSignature,
    motionPrompt: shot.motionPrompt,
    model: "turbo",
    onPoll: (s, ms) => { if (Math.round(ms / 1000) % 60 === 0) console.log(`  ${s} ${Math.round(ms/1000)}s`); },
  });

  await downloadClip(r.videoUrl, `${DIR}/shot-04.mp4`);
  console.log(`✅ shot-04.mp4 téléchargé (${(r.elapsedMs / 1000).toFixed(0)}s)`);
}
main().catch((e) => { console.error("❌", e.message); process.exit(1); });
