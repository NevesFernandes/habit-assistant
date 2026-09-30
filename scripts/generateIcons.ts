// §40 step 8: generates every app icon from the one logo source,
// branding/logo.svg. Run with `npm run icons` after changing the logo, and
// commit the output (the build doesn't run this). Dev-only: sharp is a
// devDependency, never shipped to the browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = path.join(rootDir, "branding", "logo.svg");
const publicDir = path.join(rootDir, "public");
// The logo's own tile colour (slate-900), also the manifest's background_color.
const background = "#0f172a";

const logo = fs.readFileSync(logoPath);

/** The logo as a square PNG buffer, rendered straight at `size` for crisp edges. */
function render(size: number) {
  return sharp(logo, { density: Math.ceil((72 * size) / 512) * 2 }).resize(size, size);
}

/** Opaque: the tile's transparent rounded corners filled with the tile colour. */
async function writeOpaque(size: number, outPath: string) {
  await render(size).flatten({ background }).png().toFile(outPath);
}

async function main() {
  // Favicon (index.html, the static pages) and the manifest's "any size" icon.
  fs.writeFileSync(
    path.join(publicDir, "icon.svg"),
    fs.readFileSync(logoPath, "utf-8").replace(
      /(<svg[^>]*>)/,
      "$1\n  <!-- Generated from branding/logo.svg by `npm run icons`; edit that file instead. -->",
    ),
  );

  await render(192).png().toFile(path.join(publicDir, "icon-192.png"));
  await render(512).png().toFile(path.join(publicDir, "icon-512.png"));

  // Maskable: Android crops to a circle/squircle anywhere inside the central
  // 80%, so the logo is shrunk into that safe zone on a solid background.
  const maskableSize = 512;
  const inner = Math.round(maskableSize * 0.8);
  const offset = Math.round((maskableSize - inner) / 2);
  await sharp({ create: { width: maskableSize, height: maskableSize, channels: 4, background } })
    .composite([{ input: await render(inner).png().toBuffer(), left: offset, top: offset }])
    .flatten({ background })
    .png()
    .toFile(path.join(publicDir, "icon-maskable-512.png"));

  // iOS ignores transparency and rounds the corners itself.
  await writeOpaque(180, path.join(publicDir, "apple-touch-icon.png"));

  // For Google's OAuth consent screen (Branding → App logo); not served by the app.
  await writeOpaque(120, path.join(rootDir, "branding", "google-consent-logo-120.png"));

  console.log("Icons written to public/ and branding/.");
}

await main();
