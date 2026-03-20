// ─── src/canvas/registerFonts.js ─────────────────────────────────
// Registers bundled fonts for canvas rendering.
// Solves missing text on servers without system fonts (Railway, Docker).

import { GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir  = path.join(__dirname, '..', '..', 'fonts');

/**
 * Register all bundled fonts.
 * Call once on bot startup.
 */
export function registerFonts() {
  if (!fs.existsSync(fontsDir)) {
    console.warn('[FONTS] No fonts/ directory found. Text may not render on servers without system fonts.');
    console.warn('[FONTS] Create a fonts/ folder and add a .ttf font file.');
    return;
  }

  const fontFiles = fs.readdirSync(fontsDir).filter(f => f.endsWith('.ttf') || f.endsWith('.otf'));

  if (fontFiles.length === 0) {
    console.warn('[FONTS] No font files found in fonts/ directory.');
    return;
  }

  for (const file of fontFiles) {
    const fontPath = path.join(fontsDir, file);
    const fontName = path.parse(file).name;

    try {
      GlobalFonts.registerFromPath(fontPath, fontName);
      console.log(`[FONTS] Registered: ${fontName} (${file})`);
    } catch (err) {
      console.error(`[FONTS] Failed to register ${file}:`, err.message);
    }
  }

  // List all available font families
  const families = GlobalFonts.families;
  console.log(`[FONTS] ${families.length} font families available`);
}
