/**
 * Test-only helpers (never imported by app code). They sign manifests the same
 * way scripts/ota/bundle-crypto.mjs does, so the app's WebCrypto verifier is
 * exercised against genuine publisher output rather than a mock.
 */
import { constants, createSign, generateKeyPairSync } from 'node:crypto';
import type { OtaBuildConfig } from './ota-config.js';
import type { OtaBundleInfo, UpdaterPort } from './updater-port.js';

export const FINGERPRINT_A = 'a'.repeat(32);
export const FINGERPRINT_B = 'b'.repeat(32);
export const BASE_URL = 'https://erve.example.test/mobile-updates/bundles';

export interface TestKeys {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function makeKeys(): TestKeys {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString().trim(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
  };
}

export function buildConfig(
  keys: TestKeys,
  overrides: Partial<OtaBuildConfig> = {},
): OtaBuildConfig {
  return {
    enabled: true,
    disabledReason: '',
    publicKey: keys.publicKeyPem,
    baseUrl: BASE_URL,
    allowInsecureHttp: false,
    nativeFingerprint: FINGERPRINT_A,
    ...overrides,
  };
}

export function makeRelease(buildNumber: number, overrides: Record<string, unknown> = {}) {
  return {
    version: `0.1.0-ota.${buildNumber}`,
    buildNumber,
    url: `${FINGERPRINT_A}/${buildNumber}.bundle`,
    checksum: 'ab'.repeat(256),
    sessionKey: 'aXY=:a2V5',
    sizeBytes: 1234,
    createdAt: '2026-11-17T00:00:00.000Z',
    ...overrides,
  };
}

export function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    schema: 1,
    channel: 'production',
    sequence: 1_000,
    generatedAt: '2026-11-17T00:00:00.000Z',
    latestNativeFingerprint: FINGERPRINT_A,
    releases: { [FINGERPRINT_A]: makeRelease(5) },
    ...overrides,
  };
}

export function signEnvelope(payload: unknown, privateKeyPem: string) {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = createSign('RSA-SHA256')
    .update(bytes)
    .sign({ key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING });
  return { format: 1, payload: bytes.toString('base64'), signature: signature.toString('base64') };
}

/** In-memory stand-in for the native updater plugin. */
export class FakeUpdater implements UpdaterPort {
  builtinVersion = `0.1.0-erve-native.${FINGERPRINT_A}.production`;
  currentBundle: OtaBundleInfo = { id: 'builtin', version: 'builtin', status: 'success' };
  bundles: OtaBundleInfo[] = [];
  failed: OtaBundleInfo | null = null;
  calls: string[] = [];
  downloadError: Error | null = null;
  setError: Error | null = null;
  downloadGate: Promise<void> | null = null;
  private nextId = 1;

  async getBuiltinVersion() {
    return this.builtinVersion;
  }
  async current() {
    return this.currentBundle;
  }
  async list() {
    return [this.currentBundle, ...this.bundles.filter((b) => b.id !== this.currentBundle.id)];
  }
  async download(options: { url: string; version: string; checksum: string; sessionKey: string }) {
    this.calls.push(`download:${options.version}`);
    this.lastDownload = options;
    if (this.downloadGate) await this.downloadGate;
    if (this.downloadError) throw this.downloadError;
    const bundle: OtaBundleInfo = {
      id: `bundle-${this.nextId++}`,
      version: options.version,
      status: 'pending',
    };
    this.bundles.push(bundle);
    return bundle;
  }
  lastDownload: { url: string; version: string; checksum: string; sessionKey: string } | null =
    null;
  async set(bundleId: string) {
    this.calls.push(`set:${bundleId}`);
    if (this.setError) throw this.setError;
  }
  async delete(bundleId: string) {
    this.calls.push(`delete:${bundleId}`);
    this.bundles = this.bundles.filter((b) => b.id !== bundleId);
  }
  async reset() {
    this.calls.push('reset');
  }
  async notifyAppReady() {
    this.calls.push('notifyAppReady');
  }
  async getFailedUpdate() {
    const failed = this.failed;
    this.failed = null;
    return failed;
  }
}
