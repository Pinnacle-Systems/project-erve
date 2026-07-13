#!/usr/bin/env node
/**
 * Generates the Android launcher-icon and splash-icon resources under
 * native/android-template/res/ from the source-controlled mark in
 * apps/mobile/branding/. See apps/mobile/branding/README.md for asset
 * provenance.
 *
 * This is the first stage of a two-stage reproducible pipeline:
 *   branding/erve-mark-source.png --(this script)--> native/android-template/res/**
 *   native/android-template/**     --(configure-android-theme.mjs)--> android/**
 *
 * Every output is a deterministic function of erve-mark-source.png plus the
 * constants below — rerunning reproduces byte-identical PNGs (sharp's PNG
 * encoder is deterministic for a given input buffer and options).
 *
 * Run via `pnpm --filter @erve/mobile branding:generate`.
 */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRANDING_ROOT = join(MOBILE_ROOT, 'branding');
const RES_ROOT = join(MOBILE_ROOT, 'native', 'android-template', 'res');

const MARK_SOURCE = join(BRANDING_ROOT, 'erve-mark-source.png');

// Mirrors --erp-color-surface-raised (light, packages/theme/src/theme.css) —
// a near-white neutral, not pure #ffffff, so the launcher icon reads as
// "part of the Erve surface system" rather than a generic white square. Used
// unconditionally (not values-night-specific): the home-screen launcher icon
// is a static brand asset and is intentionally NOT re-themed by the device's
// dark/light system setting the way the in-app window/splash backgrounds are.
const LAUNCHER_BACKGROUND_HEX = '#fbfcfe';

// Adaptive icon canvas is 108dp; the guaranteed-visible "safe zone" across
// circle/squircle/rounded-square/square launcher masks is the center 66dp.
// Sizing the mark's longest edge to 60% of the canvas keeps it safely inside
// that zone with a small comfort margin (legacy pre-26 icons, which are NOT
// mask-cropped by the OS, reuse this same ratio for visual consistency).
const SAFE_ZONE_SCALE = 0.6;

const ADAPTIVE_CANVAS_DP = 108;
const LEGACY_CANVAS_DP = 48;
// Splash mark is deliberately much smaller relative to its canvas than the
// launcher foreground — this is the fix for the white/plate-look bug that
// came from reusing the launcher foreground (safe-zone-scaled at 60%)
// directly as the splash's windowSplashScreenAnimatedIcon.
const SPLASH_CANVAS_PX = 480;
const SPLASH_MARK_SCALE = 0.42;

/** density qualifier -> scale factor relative to mdpi (1x) */
const DENSITIES = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

function fail(message) {
  console.error(`[generate-branding] ${message}`);
  process.exit(1);
}

if (!existsSync(MARK_SOURCE)) {
  fail(`${MARK_SOURCE} not found.`);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

/** Resize the mark to fit within `boxPx` at `scale`, preserving aspect ratio. */
async function sizedMark(boxPx, scale) {
  const meta = await sharp(MARK_SOURCE).metadata();
  const targetLongEdge = Math.round(boxPx * scale);
  const isWiderThanTall = meta.width >= meta.height;
  const width = isWiderThanTall ? targetLongEdge : Math.round((targetLongEdge * meta.width) / meta.height);
  const height = isWiderThanTall ? Math.round((targetLongEdge * meta.height) / meta.width) : targetLongEdge;
  const resized = await sharp(MARK_SOURCE)
    .resize(width, height, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png()
    .toBuffer();
  return { buffer: resized, width, height };
}

/** Transparent canvas with the mark centered — the adaptive-icon FOREGROUND layer. */
async function foregroundLayer(canvasPx) {
  const mark = await sizedMark(canvasPx, SAFE_ZONE_SCALE);
  return sharp({
    create: {
      width: canvasPx,
      height: canvasPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark.buffer, left: Math.round((canvasPx - mark.width) / 2), top: Math.round((canvasPx - mark.height) / 2) }])
    .png()
    .toBuffer();
}

/** White-silhouette (alpha-preserved) version of the mark for the Android 13+ monochrome icon layer. */
async function monochromeLayer(canvasPx) {
  const mark = await sizedMark(canvasPx, SAFE_ZONE_SCALE);
  const white = await sharp(mark.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      }
      return sharp(data, { raw: info }).png().toBuffer();
    });
  return sharp({
    create: {
      width: canvasPx,
      height: canvasPx,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: white, left: Math.round((canvasPx - mark.width) / 2), top: Math.round((canvasPx - mark.height) / 2) }])
    .png()
    .toBuffer();
}

/** Flat, single-layer legacy icon (background fill + centered mark) for API <26 / round-icon fallback. */
async function legacyIcon(canvasPx) {
  const mark = await sizedMark(canvasPx, SAFE_ZONE_SCALE);
  return sharp({
    create: {
      width: canvasPx,
      height: canvasPx,
      channels: 4,
      background: LAUNCHER_BACKGROUND_HEX,
    },
  })
    .composite([{ input: mark.buffer, left: Math.round((canvasPx - mark.width) / 2), top: Math.round((canvasPx - mark.height) / 2) }])
    .png()
    .toBuffer();
}

async function generateLauncherIcons() {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = join(RES_ROOT, `mipmap-${density}`);
    ensureDir(dir);

    const adaptiveCanvasPx = Math.round(ADAPTIVE_CANVAS_DP * scale);
    const legacyCanvasPx = Math.round(LEGACY_CANVAS_DP * scale);

    await sharp(await foregroundLayer(adaptiveCanvasPx)).toFile(join(dir, 'ic_launcher_foreground.png'));
    await sharp(await monochromeLayer(adaptiveCanvasPx)).toFile(join(dir, 'ic_launcher_monochrome.png'));
    await sharp(await legacyIcon(legacyCanvasPx)).toFile(join(dir, 'ic_launcher.png'));
    await sharp(await legacyIcon(legacyCanvasPx)).toFile(join(dir, 'ic_launcher_round.png'));

    console.log(`[generate-branding] wrote mipmap-${density} (adaptive ${adaptiveCanvasPx}px, legacy ${legacyCanvasPx}px)`);
  }
}

async function generateSplashIcon() {
  const dir = join(RES_ROOT, 'drawable-nodpi');
  ensureDir(dir);
  const mark = await sizedMark(SPLASH_CANVAS_PX, SPLASH_MARK_SCALE);
  const splash = await sharp({
    create: {
      width: SPLASH_CANVAS_PX,
      height: SPLASH_CANVAS_PX,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark.buffer, left: Math.round((SPLASH_CANVAS_PX - mark.width) / 2), top: Math.round((SPLASH_CANVAS_PX - mark.height) / 2) }])
    .png()
    .toBuffer();
  await sharp(splash).toFile(join(dir, 'erve_splash_icon.png'));
  console.log(`[generate-branding] wrote drawable-nodpi/erve_splash_icon.png (${SPLASH_CANVAS_PX}px canvas, mark ${Math.round(SPLASH_MARK_SCALE * 100)}%)`);
}

await generateLauncherIcons();
await generateSplashIcon();
console.log('[generate-branding] done.');
