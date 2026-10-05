// §49: generates the web-sized screenshots in public/screenshots/ from the
// full-size phone screenshots in branding/Screenshots/. Run with
// `npm run screenshots` after retaking one, and commit the output (the build
// doesn't run this). Dev-only: sharp is a devDependency, like in generateIcons.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(rootDir, "branding", "Screenshots");
const outDir = path.join(rootDir, "public", "screenshots");

// Sharp enough on a phone, small enough to load fast. SignIn.tsx, help.html and
// vite.config.ts hard-code the resulting sizes (720×1492 uncropped), so change
// them together.
const WIDTH = 720;

// `manifest` also writes a JPEG for the PWA manifest's `screenshots` (the
// install dialog), where WebP isn't reliably accepted.
// `rows` keeps only that band of the source image (pixels from its top), for a
// shot that illustrates one part of a screen.
const SHOTS: { source: string; name: string; manifest?: boolean; rows?: { top: number; height: number } }[] = [
  { source: "01-chat-edit-priority.jpg", name: "chat", manifest: true },
  { source: "02-chat-mark-done-voice.jpg", name: "chat-voice" },
  { source: "03-today.jpg", name: "today", manifest: true },
  { source: "08-stats-dashboard.jpg", name: "stats", manifest: true },
  { source: "09-habit-detail-heatmap.jpg", name: "habit" },
  // help.html, "Stats and the heatmap": the statistics block down to the heatmap's legend.
  { source: "09-habit-detail-heatmap.jpg", name: "habit-stats", rows: { top: 900, height: 1230 } },
];

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const shot of SHOTS) {
    const resized = () => {
      const image = sharp(path.join(sourceDir, shot.source));
      if (shot.rows) image.extract({ left: 0, top: shot.rows.top, width: 1080, height: shot.rows.height });
      return image.resize({ width: WIDTH });
    };
    await resized().webp({ quality: 80 }).toFile(path.join(outDir, `${shot.name}.webp`));
    if (shot.manifest) await resized().jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(outDir, `${shot.name}.jpg`));
  }
  console.log(`Screenshots written to public/screenshots/ (${SHOTS.length} images).`);
}

await main();
