/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { loadOtaBuildConfig, resolveNativeIdentity } from './scripts/ota/ota-config.mjs';
import baseCapacitorConfig from './capacitor.base-config.mjs';

/**
 * OTA compile-time constants. Derived from the SAME inputs as
 * capacitor.config.ts, so the web bundle and the APK it ships in (or is
 * published for) agree on the OTA public key, update URL and — critically —
 * the native fingerprint this bundle is compatible with.
 */
function otaBuildDefinitions(mode: string) {
  const env = { ...loadEnv(mode, process.cwd(), ['ERVE_', 'VITE_']), ...process.env };
  const ota = loadOtaBuildConfig({ env });
  const identity = resolveNativeIdentity({ baseConfig: baseCapacitorConfig, ota });
  const constants = {
    enabled: ota.enabled,
    disabledReason: ota.disabledReason,
    publicKey: ota.publicKey,
    baseUrl: ota.baseUrl,
    allowInsecureHttp: ota.allowInsecureHttp,
    nativeFingerprint: identity.fingerprint,
  };
  return { constants, identity };
}

/** Provenance only; a `+dirty` suffix marks a build from uncommitted changes. */
function sourceCommit(): string | null {
  const fromEnv = process.env.ERVE_OTA_SOURCE_COMMIT || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], {
      encoding: 'utf8',
    }).trim();
    return dirty ? `${head}+dirty` : head;
  } catch {
    return null;
  }
}

/**
 * Emits ota-build-info.json so the publish script can prove which native layer a
 * dist/ targets. It carries no channel: the same bytes are promoted from
 * testing to production, so the channel must come from the APK, not the bundle.
 */
function otaBuildInfoPlugin(info: { nativeFingerprint: string }): Plugin {
  return {
    name: 'erve-ota-build-info',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'ota-build-info.json',
        source: JSON.stringify({ schema: 2, ...info, sourceCommit: sourceCommit() }, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const { constants } = otaBuildDefinitions(mode);
  return {
    plugins: [
      tailwindcss(),
      react(),
      otaBuildInfoPlugin({ nativeFingerprint: constants.nativeFingerprint }),
    ],
    define: { __ERVE_OTA_BUILD__: JSON.stringify(constants) },
    server: {
      host: '127.0.0.1',
      port: 5174,
    },
    test: {
      // Rendering tests mount whole page trees in jsdom and are CPU-heavy. With the 5 s default
      // they time out on a busy machine or CI runner although every assertion is right (unmodified
      // main failed 2 of 6 full runs on a development machine). Generous limits only affect how long a
      // genuinely hung test takes to be reported; they weaken no assertion.
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
