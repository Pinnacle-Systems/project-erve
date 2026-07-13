import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import capacitorConfig from '../../capacitor.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.join(__dirname, '..', '..');
const TEMPLATE_ROOT = __dirname;
const THEME_CSS_PATH = path.join(MOBILE_ROOT, '..', '..', 'packages', 'theme', 'src', 'theme.css');
const ANDROID_ROOT = path.join(MOBILE_ROOT, 'android');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractBalancedBlock(css: string, openMarker: string): string {
  const startIdx = css.indexOf(openMarker);
  if (startIdx === -1) throw new Error(`Could not locate marker: ${openMarker}`);
  const braceStart = css.indexOf('{', startIdx);
  let depth = 0;
  let i = braceStart;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(braceStart + 1, i);
}

function extractDeclarations(blockText: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const regex = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(blockText)) !== null) {
    const [, name, value] = match;
    if (name && value) declarations.set(name, value.trim());
  }
  return declarations;
}

function extractXmlColors(xml: string): Map<string, string> {
  const colors = new Map<string, string>();
  const regex = /<color name="([\w-]+)">([^<]+)<\/color>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const [, name, value] = match;
    if (name && value) colors.set(name, value.trim());
  }
  return colors;
}

function resolveXmlColor(colors: Map<string, string>, name: string): string {
  const value = colors.get(name);
  if (!value) throw new Error(`Undefined color resource: ${name}`);
  const refMatch = /^@color\/([\w-]+)$/.exec(value);
  return refMatch ? resolveXmlColor(colors, refMatch[1]!) : value;
}

/**
 * Part 9 automated native-configuration checks for the Android theme
 * integration. These only validate the source-controlled template files and
 * capacitor.config.ts — see this file's sibling `android/` directory notes
 * (gitignored, generated) for why full build/visual verification instead
 * relies on emulator testing (documented in CAPACITOR_AUTH_TESTING.md).
 */
describe('Android native theme template', () => {
  const css = stripComments(readFileSync(THEME_CSS_PATH, 'utf8').replace(/\r\n/g, '\n'));
  const lightVars = extractDeclarations(extractBalancedBlock(css, '[data-theme="default"] {'));
  const darkVars = extractDeclarations(extractBalancedBlock(css, '.dark,'));

  const lightColorsXml = readFileSync(path.join(TEMPLATE_ROOT, 'res', 'values', 'colors.xml'), 'utf8');
  const nightColorsXml = readFileSync(
    path.join(TEMPLATE_ROOT, 'res', 'values-night', 'colors.xml'),
    'utf8',
  );
  const lightColors = extractXmlColors(lightColorsXml);
  const nightColors = extractXmlColors(nightColorsXml);

  it('light erve_window_background matches --erp-color-app-bg (light)', () => {
    expect(resolveXmlColor(lightColors, 'erve_window_background').toLowerCase()).toBe(
      lightVars.get('--erp-color-app-bg'),
    );
  });

  it('dark erve_window_background matches --erp-color-app-bg (.dark)', () => {
    expect(resolveXmlColor(nightColors, 'erve_window_background').toLowerCase()).toBe(
      darkVars.get('--erp-color-app-bg'),
    );
  });

  it('light erve_primary matches --erp-color-primary (light)', () => {
    expect(resolveXmlColor(lightColors, 'erve_primary').toLowerCase()).toBe(
      lightVars.get('--erp-color-primary'),
    );
  });

  it('dark erve_primary matches --erp-color-primary (.dark)', () => {
    expect(resolveXmlColor(nightColors, 'erve_primary').toLowerCase()).toBe(
      darkVars.get('--erp-color-primary'),
    );
  });

  it.each(['values', 'values-night'])('%s/styles.xml only references colors defined in the matching colors.xml', (dir) => {
    const stylesXml = readFileSync(path.join(TEMPLATE_ROOT, 'res', dir, 'styles.xml'), 'utf8');
    const colorsXml = dir === 'values' ? lightColorsXml : nightColorsXml;
    const definedColors = extractXmlColors(colorsXml);
    const referenced = [...stylesXml.matchAll(/@color\/([\w-]+)/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(definedColors.has(name), `@color/${name} referenced by ${dir}/styles.xml is undefined`).toBe(true);
    }
  });

  it('MainActivity.java registers NativeThemeBridgePlugin', () => {
    const mainActivity = readFileSync(path.join(TEMPLATE_ROOT, 'java', 'MainActivity.java'), 'utf8');
    expect(mainActivity).toMatch(/registerPlugin\(NativeThemeBridgePlugin\.class\)/);
  });

  it('capacitor.config.ts defers splash auto-hide to NativeThemeSurfaces', () => {
    expect(capacitorConfig.plugins?.SplashScreen?.launchAutoHide).toBe(false);
  });

  it('capacitor.config.ts declares StatusBar plugin config', () => {
    expect(capacitorConfig.plugins?.StatusBar).toBeDefined();
  });

  // Only runs when android/ has already been generated locally (`cap add
  // android` / `cap sync`) — it is gitignored and absent on a clean CI
  // checkout, which is expected; see Part 1 of the native theme task.
  const androidExists = existsSync(path.join(ANDROID_ROOT, 'app', 'src', 'main', 'AndroidManifest.xml'));
  it.skipIf(!androidExists)(
    'configure-android-theme.mjs is idempotent against a generated android/ platform',
    () => {
      const scriptPath = path.join(MOBILE_ROOT, 'scripts', 'configure-android-theme.mjs');
      const targets = [
        path.join(ANDROID_ROOT, 'app', 'src', 'main', 'res', 'values', 'colors.xml'),
        path.join(ANDROID_ROOT, 'app', 'src', 'main', 'res', 'values-night', 'colors.xml'),
        path.join(ANDROID_ROOT, 'app', 'src', 'main', 'res', 'values', 'styles.xml'),
        path.join(ANDROID_ROOT, 'app', 'src', 'main', 'res', 'values-night', 'styles.xml'),
      ];

      execFileSync(process.execPath, [scriptPath], { stdio: 'pipe' });
      const firstRun = targets.map((p) => readFileSync(p, 'utf8'));
      execFileSync(process.execPath, [scriptPath], { stdio: 'pipe' });
      const secondRun = targets.map((p) => readFileSync(p, 'utf8'));

      expect(secondRun).toEqual(firstRun);
    },
  );
});
