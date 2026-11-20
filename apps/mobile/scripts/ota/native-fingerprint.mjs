/**
 * Native-compatibility fingerprint for OTA web bundles.
 *
 * An OTA bundle may only be installed on an APK whose native layer is
 * identical to the one the bundle was built against. This module computes a
 * deterministic fingerprint of everything that defines that native layer, so
 * the rule "binary-incompatible change => new APK" is enforced by a hash
 * comparison rather than by a human remembering to bump a number.
 *
 * Inputs (all tracked sources or lockfile-resolved installs — deliberately NOT
 * the gitignored, generated android/ project, so the value is identical in
 * `capacitor.config.ts`, `vite.config.ts`, CI and the publish script no matter
 * whether the platform has been generated yet):
 *
 *   1. Every file under native/android-template/ except *.test.ts (Java
 *      bridge plugins, themes, launcher/splash resources — text files are
 *      line-ending normalised so a CRLF Windows checkout hashes the same).
 *   2. Name@version of every installed Capacitor plugin / native dependency
 *      declared by apps/mobile/package.json (anything under @capacitor/,
 *      @capacitor-community/, @capgo/ or cordova-plugin-, or that ships an
 *      Android project or a "capacitor" manifest key).
 *      Adding, removing or upgrading a plugin therefore changes the
 *      fingerprint — and with it the APK's permission/manifest surface.
 *   3. The effective Capacitor config (app id, plugin config incl. the OTA
 *      public key and httpsOnly flag), excluding the fingerprint-bearing
 *      `plugins.CapacitorUpdater.version` field itself.
 *   4. native/NATIVE_EPOCH — a manual escape hatch. Bump it when a native
 *      change is made somewhere this hash cannot see (e.g. a hand-edit of the
 *      generated android/ project that is not captured in the template).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FINGERPRINT_SCHEMA = 1;
/** Hex characters kept from the SHA-256 digest (128 bits). */
export const FINGERPRINT_LENGTH = 32;

const DEFAULT_MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Anything under these scopes/prefixes is treated as native-affecting even if
 * its package layout is unusual: a plugin that is wrongly counted only costs an
 * unnecessary APK, one that is wrongly ignored would let an incompatible
 * bundle through.
 */
const NATIVE_SCOPES = ['@capacitor/', '@capacitor-community/', '@capgo/', 'cordova-plugin-'];
const TEXT_EXTENSIONS = new Set([
  '.java',
  '.xml',
  '.gradle',
  '.properties',
  '.txt',
  '.json',
  '.kt',
]);

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}

function normaliseFile(path) {
  const raw = readFileSync(path);
  if (!TEXT_EXTENSIONS.has(extensionOf(path))) return raw;
  return Buffer.from(raw.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Stable JSON: object keys sorted recursively so key order never matters. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function templateComponents(mobileRoot) {
  const templateRoot = join(mobileRoot, 'native', 'android-template');
  if (!existsSync(templateRoot)) {
    throw new Error(`Native template directory not found: ${templateRoot}`);
  }
  return walk(templateRoot)
    .filter((file) => !/\.test\.ts$/.test(file))
    .map((file) => [
      relative(templateRoot, file).split(sep).join('/'),
      sha256Hex(normaliseFile(file)),
    ])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function nativeDependencyComponents(mobileRoot) {
  const manifest = JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8'));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const out = [];
  for (const name of declared.sort()) {
    const installedManifest = join(mobileRoot, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(installedManifest)) continue;
    const installed = JSON.parse(readFileSync(installedManifest, 'utf8'));
    const packageDir = dirname(installedManifest);
    const shipsAndroid = existsSync(join(packageDir, 'android', 'build.gradle'));
    if (
      NATIVE_SCOPES.some((scope) => name.startsWith(scope)) ||
      installed.capacitor ||
      shipsAndroid
    ) {
      out.push(`${name}@${installed.version}`);
    }
  }
  return out;
}

function epochComponent(mobileRoot) {
  const epochFile = join(mobileRoot, 'native', 'NATIVE_EPOCH');
  return existsSync(epochFile) ? readFileSync(epochFile, 'utf8').trim() : '0';
}

/** Capacitor config with the fingerprint-bearing field removed. */
export function stripFingerprintFields(config) {
  const clone = JSON.parse(JSON.stringify(config));
  if (clone?.plugins?.CapacitorUpdater) delete clone.plugins.CapacitorUpdater.version;
  return clone;
}

/**
 * @param {{ mobileRoot?: string, config: object }} options
 * @returns {{ fingerprint: string, components: object }}
 */
export function computeNativeFingerprint({ mobileRoot = DEFAULT_MOBILE_ROOT, config }) {
  if (!config) throw new Error('computeNativeFingerprint requires the Capacitor config');
  const components = {
    schema: FINGERPRINT_SCHEMA,
    template: templateComponents(mobileRoot),
    dependencies: nativeDependencyComponents(mobileRoot),
    config: stripFingerprintFields(config),
    epoch: epochComponent(mobileRoot),
  };
  const fingerprint = sha256Hex(Buffer.from(stableStringify(components), 'utf8')).slice(
    0,
    FINGERPRINT_LENGTH,
  );
  return { fingerprint, components };
}

const BUILTIN_VERSION_PATTERN = /-erve-native\.([0-9a-f]{32})\.([a-z0-9][a-z0-9_-]{0,31})$/;

/**
 * The value injected as `plugins.CapacitorUpdater.version`. The updater plugin
 * reports it from getBuiltinVersion() on the device, which is how the app
 * learns — from the APK itself, not from the (replaceable) web bundle — which
 * native layer it runs on and which release channel it follows.
 *
 * The channel is deliberately NOT part of the fingerprint: a testing APK and a
 * production APK built from the same sources share one fingerprint, so the very
 * same OTA bundle bytes that were tested can be promoted to production.
 */
export function formatBuiltinVersion(appVersion, fingerprint, channel) {
  return `${appVersion}-erve-native.${fingerprint}.${channel}`;
}

/** @returns {{ fingerprint: string, channel: string } | null} */
export function parseBuiltinVersion(value) {
  const match = BUILTIN_VERSION_PATTERN.exec(value ?? '');
  return match ? { fingerprint: match[1], channel: match[2] } : null;
}

export function readMobilePackageVersion(mobileRoot = DEFAULT_MOBILE_ROOT) {
  return JSON.parse(readFileSync(join(mobileRoot, 'package.json'), 'utf8')).version;
}
