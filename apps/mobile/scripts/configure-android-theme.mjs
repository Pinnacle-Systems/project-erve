#!/usr/bin/env node
/**
 * Applies the source-controlled native/android-template/ files on top of the
 * generated (gitignored) android/ Capacitor platform.
 *
 * apps/mobile/android is intentionally NOT tracked in git (see .gitignore
 * and apps/mobile/CAPACITOR_AUTH_TESTING.md's "Android native theming"
 * section) — it has never been committed and is fully reproducible via
 * `cap add android` / `cap sync`. Rather than tracking the whole generated
 * platform, this script re-applies our small set of hand-authored
 * theme/native-bridge files, plus the generated launcher-icon and
 * splash-icon resources (see apps/mobile/scripts/generate-branding.mjs),
 * after every sync/add so the result is deterministic from a clean checkout.
 *
 * Safe to rerun: every step is a whole-file copy from a fixed source to a
 * fixed destination, never a partial/regex edit — rerunning always produces
 * byte-identical output.
 *
 * Run via `pnpm --filter @erve/mobile native:theme:android`, or automatically
 * as part of `cap:sync` / `cap:add:android` (see package.json).
 */
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_ROOT = join(MOBILE_ROOT, 'native', 'android-template');
const ANDROID_ROOT = join(MOBILE_ROOT, 'android');
const RES_ROOT = join(ANDROID_ROOT, 'app', 'src', 'main', 'res');
const JAVA_ROOT = join(ANDROID_ROOT, 'app', 'src', 'main', 'java', 'com', 'erve', 'mobile');

const ANCHOR_FILE = join(ANDROID_ROOT, 'app', 'src', 'main', 'AndroidManifest.xml');

const LAUNCHER_DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const LAUNCHER_MIPMAP_FILES = ['ic_launcher_foreground.png', 'ic_launcher_monochrome.png', 'ic_launcher.png', 'ic_launcher_round.png'];

/** [sourceRelativeToTemplate, destinationAbsolutePath][] */
const FILES = [
  ['res/values/colors.xml', join(RES_ROOT, 'values', 'colors.xml')],
  ['res/values-night/colors.xml', join(RES_ROOT, 'values-night', 'colors.xml')],
  ['res/values/styles.xml', join(RES_ROOT, 'values', 'styles.xml')],
  ['res/values-night/styles.xml', join(RES_ROOT, 'values-night', 'styles.xml')],
  ['java/MainActivity.java', join(JAVA_ROOT, 'MainActivity.java')],
  ['java/NativeThemeBridgePlugin.java', join(JAVA_ROOT, 'NativeThemeBridgePlugin.java')],
  ['res/mipmap-anydpi-v26/ic_launcher.xml', join(RES_ROOT, 'mipmap-anydpi-v26', 'ic_launcher.xml')],
  ['res/mipmap-anydpi-v26/ic_launcher_round.xml', join(RES_ROOT, 'mipmap-anydpi-v26', 'ic_launcher_round.xml')],
  ['res/drawable-nodpi/erve_splash_icon.png', join(RES_ROOT, 'drawable-nodpi', 'erve_splash_icon.png')],
  ...LAUNCHER_DENSITIES.flatMap((density) =>
    LAUNCHER_MIPMAP_FILES.map((file) => [
      `res/mipmap-${density}/${file}`,
      join(RES_ROOT, `mipmap-${density}`, file),
    ]),
  ),
];

function fail(message) {
  console.error(`[configure-android-theme] ${message}`);
  process.exit(1);
}

if (!existsSync(ANCHOR_FILE)) {
  fail(
    `${ANCHOR_FILE} not found. The Android platform must exist first — run ` +
      '`pnpm --filter @erve/mobile cap:add:android` (or cap:sync if it already exists ' +
      'elsewhere) before running this script.',
  );
}

for (const [relSrc, dest] of FILES) {
  const src = join(TEMPLATE_ROOT, relSrc);
  if (!existsSync(src)) {
    fail(`Template file missing: ${src}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`[configure-android-theme] wrote ${dest}`);
}

console.log('[configure-android-theme] done.');
