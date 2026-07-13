/** @vitest-environment node */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(MOBILE_ROOT, '..', '..');
const TEMPLATE_RES = path.join(MOBILE_ROOT, 'native', 'android-template', 'res');

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;
const ADAPTIVE_CANVAS_DP = 108;
const LEGACY_CANVAS_DP = 48;

const STOCK_PALETTE_PATTERN =
  /\b(bg|text|border)-(white|black|gray|slate|zinc|neutral|stone|red|blue|green|yellow|indigo|purple|pink)-\d+\b|\bbg-white\b/;

async function cornerAlpha(file: string): Promise<number> {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[3]; // top-left pixel's alpha channel
}

/**
 * Part 9 automated branding checks: validates the Erve launcher/splash
 * assets are real (not the Capacitor placeholder), reproducible from the
 * source-controlled inputs in this directory, and that the `@erve/ui`
 * retirement left no stragglers. Complements android-native-theme.test.ts's
 * theme/color checks and, like that file, cannot prove the icon looks
 * correct under every real launcher mask — see Part 10 (emulator
 * verification) in the project's final report for that.
 */
describe('canonical branding source assets', () => {
  it('erve-logo.png (mobile) is byte-identical to the web asset it was duplicated from', () => {
    const mobileLogo = readFileSync(path.join(MOBILE_ROOT, 'branding', 'erve-logo.png'));
    const webLogo = readFileSync(path.join(REPO_ROOT, 'apps', 'web', 'public', 'erve-logo.png'));
    expect(mobileLogo.equals(webLogo)).toBe(true);
  });

  it('erve-mark-source.png is a transparent, non-trivial-resolution extraction', async () => {
    const meta = await sharp(path.join(MOBILE_ROOT, 'branding', 'erve-mark-source.png')).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeGreaterThanOrEqual(150);
    expect(meta.height).toBeGreaterThanOrEqual(100);
  });
});

describe('Android adaptive launcher icon resources', () => {
  it.each(Object.entries(DENSITIES))('mipmap-%s has correctly-sized foreground/monochrome/legacy assets', async (density, scale) => {
    const dir = path.join(TEMPLATE_RES, `mipmap-${density}`);
    const adaptivePx = Math.round(ADAPTIVE_CANVAS_DP * scale);
    const legacyPx = Math.round(LEGACY_CANVAS_DP * scale);

    for (const [file, expectedPx] of [
      ['ic_launcher_foreground.png', adaptivePx],
      ['ic_launcher_monochrome.png', adaptivePx],
      ['ic_launcher.png', legacyPx],
      ['ic_launcher_round.png', legacyPx],
    ] as const) {
      const full = path.join(dir, file);
      expect(existsSync(full), `${full} should exist`).toBe(true);
      const meta = await sharp(full).metadata();
      expect(meta.width, `${file} width`).toBe(expectedPx);
      expect(meta.height, `${file} height`).toBe(expectedPx);
    }

    // Foreground/monochrome are transparent at the corners (adaptive-icon
    // layers must not bake in an opaque plate); legacy icons are fully
    // opaque everywhere (single flattened image, no mask support pre-26).
    expect(await cornerAlpha(path.join(dir, 'ic_launcher_foreground.png'))).toBe(0);
    expect(await cornerAlpha(path.join(dir, 'ic_launcher_monochrome.png'))).toBe(0);
    expect(await cornerAlpha(path.join(dir, 'ic_launcher.png'))).toBe(255);
  });

  it('ic_launcher.xml / ic_launcher_round.xml reference the Erve background and no longer the Capacitor placeholder', () => {
    for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const xml = readFileSync(path.join(TEMPLATE_RES, 'mipmap-anydpi-v26', file), 'utf8');
      expect(xml).toMatch(/@color\/erve_launcher_background/);
      expect(xml).toMatch(/@mipmap\/ic_launcher_foreground/);
      expect(xml).toMatch(/@mipmap\/ic_launcher_monochrome/);
      expect(xml).not.toMatch(/@color\/ic_launcher_background"/); // stock Capacitor color name (no erve_ prefix)
    }
  });

  it('erve_launcher_background is defined in values/colors.xml', () => {
    const xml = readFileSync(path.join(TEMPLATE_RES, 'values', 'colors.xml'), 'utf8');
    expect(xml).toMatch(/<color name="erve_launcher_background">#[0-9A-Fa-f]{6}<\/color>/);
  });
});

describe('Android splash icon resources', () => {
  it('drawable-nodpi/erve_splash_icon.png exists, is transparent, and is distinct from the launcher foreground', async () => {
    const splashPath = path.join(TEMPLATE_RES, 'drawable-nodpi', 'erve_splash_icon.png');
    expect(existsSync(splashPath)).toBe(true);
    const meta = await sharp(splashPath).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(await cornerAlpha(splashPath)).toBe(0);

    const foregroundPath = path.join(TEMPLATE_RES, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png');
    const splashBuf = readFileSync(splashPath);
    const foregroundBuf = readFileSync(foregroundPath);
    expect(splashBuf.equals(foregroundBuf), 'splash icon must be a purpose-built asset, not a copy of the launcher foreground').toBe(false);
  });

  it.each(['values', 'values-night'])('%s/styles.xml points the splash screen at the purpose-built drawable, not the launcher mipmap', (dir) => {
    const xml = readFileSync(path.join(TEMPLATE_RES, dir, 'styles.xml'), 'utf8');
    expect(xml).toMatch(/windowSplashScreenAnimatedIcon">@drawable\/erve_splash_icon</);
    expect(xml).not.toMatch(/windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher_foreground</);
  });
});

describe('configure-android-theme.mjs copies every branding resource', () => {
  it('lists every generated mipmap density + splash drawable + adaptive-icon XML in its FILES table', () => {
    const script = readFileSync(path.join(MOBILE_ROOT, 'scripts', 'configure-android-theme.mjs'), 'utf8');
    for (const density of Object.keys(DENSITIES)) {
      expect(script).toContain(`'${density}'`);
    }
    expect(script).toContain('drawable-nodpi/erve_splash_icon.png');
    expect(script).toContain('mipmap-anydpi-v26/ic_launcher.xml');
    expect(script).toContain('mipmap-anydpi-v26/ic_launcher_round.xml');
  });
});

describe('@erve/ui retirement', () => {
  const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.json', '.md']);
  const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'android', '.git', 'branding']);

  function walk(dir: string, files: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (IGNORED_DIR_NAMES.has(entry)) continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full, files);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
        files.push(full);
      }
    }
    return files;
  }

  it('packages/ui no longer exists', () => {
    expect(existsSync(path.join(REPO_ROOT, 'packages', 'ui'))).toBe(false);
  });

  it('no file under apps/ or packages/ imports or references @erve/ui', () => {
    const files = [
      ...walk(path.join(REPO_ROOT, 'apps')),
      ...walk(path.join(REPO_ROOT, 'packages')),
    ];
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('@erve/ui'));
    expect(offenders, `unexpected @erve/ui references: ${offenders.join(', ')}`).toEqual([]);
  }, 20000);
});

describe('Login page branding', () => {
  const loginSource = readFileSync(path.join(MOBILE_ROOT, 'src', 'pages', 'LoginPage.tsx'), 'utf8');

  it('references the canonical Erve logo asset with meaningful alt text', () => {
    expect(loginSource).toMatch(/from ['"]\.\.\/\.\.\/branding\/erve-logo\.png['"]/);
    expect(loginSource).toMatch(/alt="Erve India"/);
  });

  it('does not render a redundant text-only "Erve" heading alongside the logo image', () => {
    expect(loginSource).not.toMatch(/>Erve<\//);
  });

  it('Login/Dashboard/LoginForm contain no stock Tailwind palette classes', () => {
    const dashboardSource = readFileSync(path.join(MOBILE_ROOT, 'src', 'pages', 'DashboardPage.tsx'), 'utf8');
    const loginFormSource = readFileSync(path.join(MOBILE_ROOT, 'src', 'components', 'LoginForm.tsx'), 'utf8');
    for (const [name, source] of [
      ['LoginPage.tsx', loginSource],
      ['DashboardPage.tsx', dashboardSource],
      ['LoginForm.tsx', loginFormSource],
    ] as const) {
      expect(source, `${name} should not contain stock Tailwind palette classes`).not.toMatch(STOCK_PALETTE_PATTERN);
    }
  });
});
