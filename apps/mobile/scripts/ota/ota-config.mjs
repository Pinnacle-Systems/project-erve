/**
 * Build-time OTA configuration, shared by capacitor.config.ts (native plugin
 * config), vite.config.ts (compile-time constants for the web bundle) and the
 * publish/verify scripts, so all of them agree on one source of truth.
 *
 * Fail-closed: if anything required for *authenticated* updates is missing
 * (public key, update URL) OTA is reported as disabled with a reason, the
 * native updater is left inert, and the app simply runs its embedded bundle.
 * An unauthenticated OTA configuration is never produced.
 *
 * Environment:
 *   ERVE_OTA_PUBLIC_KEY_FILE   path to the RSA-2048 PEM public key
 *   ERVE_OTA_PUBLIC_KEY        …or the PEM text itself
 *   (default)                  apps/mobile/ota/ota-public-key.pem when present
 *   ERVE_OTA_BASE_URL          https://<host>/mobile-updates/bundles
 *   VITE_API_URL               fallback: https://<host>/api -> that host's /mobile-updates/bundles
 *   ERVE_OTA_CHANNEL           channel THIS APK follows: "production" (default) or
 *                              "testing". Baked into the APK's native version only;
 *                              never into the web bundle, so a tested bundle can be
 *                              promoted to production byte-for-byte.
 *   ERVE_OTA_ALLOW_INSECURE_HTTP=1
 *                              LOCAL VERIFICATION ONLY: permits an http:// update
 *                              server (adb reverse). Part of the native config,
 *                              so such an APK has a different native fingerprint
 *                              and can never receive a production bundle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeNativeFingerprint,
  formatBuiltinVersion,
  readMobilePackageVersion,
} from './native-fingerprint.mjs';

const DEFAULT_MOBILE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHANNELS = ['testing', 'production'];
const DEFAULT_CHANNEL = 'production';
/**
 * Native rollback window: the new bundle must call notifyAppReady within this.
 * The plugin waits this long twice on the reload path, so a bundle that never
 * becomes ready is reverted after roughly twice this value.
 */
export const APP_READY_TIMEOUT_MS = 10000;

export function normalisePublicKey(pem) {
  const trimmed = pem.trim().replace(/\r\n?/g, '\n');
  if (
    !/^-----BEGIN RSA PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END RSA PUBLIC KEY-----$/.test(
      trimmed,
    )
  ) {
    throw new Error(
      'OTA public key must be a PKCS#1 PEM ("-----BEGIN RSA PUBLIC KEY-----"), as produced by `pnpm --filter @erve/mobile ota:keygen`.',
    );
  }
  return trimmed;
}

function readPublicKey(mobileRoot, env) {
  if (env.ERVE_OTA_PUBLIC_KEY) return normalisePublicKey(env.ERVE_OTA_PUBLIC_KEY);
  const file = env.ERVE_OTA_PUBLIC_KEY_FILE
    ? isAbsolute(env.ERVE_OTA_PUBLIC_KEY_FILE)
      ? env.ERVE_OTA_PUBLIC_KEY_FILE
      : resolve(process.cwd(), env.ERVE_OTA_PUBLIC_KEY_FILE)
    : join(mobileRoot, 'ota', 'ota-public-key.pem');
  return existsSync(file) ? normalisePublicKey(readFileSync(file, 'utf8')) : '';
}

export function deriveBaseUrl(env) {
  if (env.ERVE_OTA_BASE_URL) return env.ERVE_OTA_BASE_URL.replace(/\/+$/, '');
  const api = env.VITE_API_URL;
  if (api) {
    try {
      const url = new URL(api);
      if (url.pathname.replace(/\/+$/, '') === '/api') {
        return `${url.origin}/mobile-updates/bundles`;
      }
    } catch {
      /* fall through: not derivable */
    }
  }
  return '';
}

/**
 * @returns {{
 *   enabled: boolean, disabledReason: string, publicKey: string, baseUrl: string,
 *   channel: string, allowInsecureHttp: boolean
 * }}
 */
export function loadOtaBuildConfig({ mobileRoot = DEFAULT_MOBILE_ROOT, env = process.env } = {}) {
  const channel = env.ERVE_OTA_CHANNEL || DEFAULT_CHANNEL;
  if (!CHANNELS.includes(channel)) {
    throw new Error(`ERVE_OTA_CHANNEL "${channel}" must be one of: ${CHANNELS.join(', ')}`);
  }
  const allowInsecureHttp = env.ERVE_OTA_ALLOW_INSECURE_HTTP === '1';
  const publicKey = readPublicKey(mobileRoot, env);
  const baseUrl = deriveBaseUrl(env);

  let disabledReason = '';
  if (!publicKey) {
    disabledReason = 'no OTA public key configured (ERVE_OTA_PUBLIC_KEY_FILE)';
  } else if (!baseUrl) {
    disabledReason =
      'no OTA update URL configured (ERVE_OTA_BASE_URL or an https VITE_API_URL ending /api)';
  } else if (!/^https:\/\//i.test(baseUrl) && !(allowInsecureHttp && /^http:\/\//i.test(baseUrl))) {
    disabledReason = 'OTA update URL must be https';
  }
  return {
    enabled: disabledReason === '',
    disabledReason,
    publicKey,
    baseUrl,
    channel,
    allowInsecureHttp,
  };
}

/** The `plugins.CapacitorUpdater` block, minus the fingerprint-bearing version. */
export function buildUpdaterPluginConfig(ota) {
  return {
    // Manual mode: every decision (check, download, when to activate) is made
    // by apps/mobile/src/ota. The plugin only downloads, verifies, stores,
    // switches and rolls back.
    autoUpdate: false,
    // The plugin phones home to Capgo Cloud by default. This is self-hosted:
    // empty strings disable update checks, stats and channel calls entirely.
    updateUrl: '',
    statsUrl: '',
    channelUrl: '',
    allowModifyUrl: false,
    // Native rollback: a bundle that does not call notifyAppReady() within
    // this window is reverted to the last good bundle (or the embedded one).
    appReadyTimeout: APP_READY_TIMEOUT_MS,
    resetWhenUpdate: true,
    autoDeleteFailed: true,
    autoDeletePrevious: true,
    // Authenticity: with a public key set the native layer refuses any bundle
    // whose checksum/session key were not produced by the matching private key.
    ...(ota.publicKey ? { publicKey: ota.publicKey } : {}),
    httpsOnly: !ota.allowInsecureHttp,
  };
}

/**
 * Full Capacitor config object (without the `version` field) plus the
 * resulting native fingerprint and the final plugin `version` value.
 */
export function resolveNativeIdentity({ baseConfig, ota, mobileRoot = DEFAULT_MOBILE_ROOT }) {
  const config = {
    ...baseConfig,
    plugins: { ...baseConfig.plugins, CapacitorUpdater: buildUpdaterPluginConfig(ota) },
  };
  const { fingerprint, components } = computeNativeFingerprint({ mobileRoot, config });
  const builtinVersion = formatBuiltinVersion(
    readMobilePackageVersion(mobileRoot),
    fingerprint,
    ota.channel,
  );
  return { config, fingerprint, components, builtinVersion };
}
