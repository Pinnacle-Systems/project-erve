/**
 * Cross-boundary tests: the Node publisher (scripts/ota/*.mjs) against the
 * app-side verifier (src/ota/*.ts). Lives outside src/ so tsc does not need
 * declarations for the .mjs publisher modules.
 */
import { createPublicKey, createVerify, constants } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decryptBundle,
  encryptBundle,
  generateKeyPair,
  keysMatch,
  publicKeyFromPrivate,
  signManifest,
  verifyManifestEnvelope,
} from './bundle-crypto.mjs';
import {
  computeNativeFingerprint,
  formatBuiltinVersion,
  parseBuiltinVersion,
} from './native-fingerprint.mjs';
import { loadOtaBuildConfig, resolveNativeIdentity } from './ota-config.mjs';
import { pkcs1PemToSpki } from '../../src/ota/rsa.js';
import { ManifestError, verifyAndParseManifest } from '../../src/ota/manifest.js';
import { parseNativeFingerprint, parseNativeIdentity } from '../../src/ota/ota-service.js';

const scratch = mkdtempSync(join(tmpdir(), 'erve-ota-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function dir(name: string): string {
  counter += 1;
  const path = join(scratch, `${name}-${counter}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function write(root: string, relative: string, contents: string | Buffer) {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

// ---------------------------------------------------------------------------
// Native fingerprint
// ---------------------------------------------------------------------------

function fakeMobileRoot(overrides: { plugin?: string; javaCrlf?: boolean } = {}) {
  const root = dir('mobile');
  write(
    root,
    'package.json',
    JSON.stringify({
      version: '1.2.3',
      dependencies: {
        '@capacitor/core': '^8.0.0',
        '@capgo/capacitor-updater': '8.54.2',
        react: '^19.0.0',
      },
    }),
  );
  write(root, 'node_modules/@capacitor/core/package.json', JSON.stringify({ version: '8.4.1' }));
  write(
    root,
    'node_modules/@capgo/capacitor-updater/package.json',
    JSON.stringify({ version: overrides.plugin ?? '8.54.2', capacitor: { android: {} } }),
  );
  write(root, 'node_modules/react/package.json', JSON.stringify({ version: '19.2.0' }));
  const java = 'class A {\n  void f() {}\n}\n';
  write(
    root,
    'native/android-template/java/A.java',
    overrides.javaCrlf ? java.replace(/\n/g, '\r\n') : java,
  );
  write(root, 'native/android-template/res/values/colors.xml', '<resources/>\n');
  write(root, 'native/android-template/native.test.ts', 'ignored');
  return root;
}

const CONFIG = { appId: 'com.erve.mobile', plugins: { CapacitorUpdater: { publicKey: 'k' } } };
const fingerprintOf = (root: string, config: object = CONFIG) =>
  computeNativeFingerprint({ mobileRoot: root, config }).fingerprint;

describe('native fingerprint', () => {
  it('is deterministic, 128-bit hex, and ignores line endings', () => {
    const lf = fingerprintOf(fakeMobileRoot());
    expect(lf).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintOf(fakeMobileRoot())).toBe(lf);
    expect(fingerprintOf(fakeMobileRoot({ javaCrlf: true }))).toBe(lf);
  });

  it('changes when a native source file changes', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    write(root, 'native/android-template/java/A.java', 'class A { void g() {} }\n');
    expect(fingerprintOf(root)).not.toBe(before);
  });

  it('changes when a native file is added or a resource changes', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    write(root, 'native/android-template/java/NewBridge.java', 'class NewBridge {}\n');
    const added = fingerprintOf(root);
    expect(added).not.toBe(before);
    write(
      root,
      'native/android-template/res/values/colors.xml',
      '<resources><color/></resources>\n',
    );
    expect(fingerprintOf(root)).not.toBe(added);
  });

  it('is unaffected by template test files', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    write(root, 'native/android-template/native.test.ts', 'changed');
    expect(fingerprintOf(root)).toBe(before);
  });

  it('changes when a Capacitor plugin is upgraded, added or removed', () => {
    const base = fingerprintOf(fakeMobileRoot());
    expect(fingerprintOf(fakeMobileRoot({ plugin: '8.55.0' }))).not.toBe(base);

    const added = fakeMobileRoot();
    write(
      added,
      'package.json',
      JSON.stringify({
        version: '1.2.3',
        dependencies: {
          '@capacitor/core': '^8.0.0',
          '@capgo/capacitor-updater': '8.54.2',
          '@capacitor/camera': '^8',
        },
      }),
    );
    write(
      added,
      'node_modules/@capacitor/camera/package.json',
      JSON.stringify({ version: '8.0.0' }),
    );
    expect(fingerprintOf(added)).not.toBe(base);
  });

  it('ignores plain JavaScript dependencies and the app version (web-only changes)', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    write(root, 'node_modules/react/package.json', JSON.stringify({ version: '19.9.9' }));
    write(
      root,
      'package.json',
      JSON.stringify({
        version: '9.9.9',
        dependencies: {
          '@capacitor/core': '^8.0.0',
          '@capgo/capacitor-updater': '8.54.2',
          react: '^19.0.0',
        },
      }),
    );
    expect(fingerprintOf(root)).toBe(before);
  });

  it('changes when native config changes (incl. the OTA public key) but not the injected version', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    expect(fingerprintOf(root, { ...CONFIG, appId: 'com.other' })).not.toBe(before);
    expect(
      fingerprintOf(root, { ...CONFIG, plugins: { CapacitorUpdater: { publicKey: 'rotated' } } }),
    ).not.toBe(before);
    expect(
      fingerprintOf(root, {
        ...CONFIG,
        plugins: { CapacitorUpdater: { publicKey: 'k', version: 'whatever' } },
      }),
    ).toBe(before);
  });

  it('honours the manual NATIVE_EPOCH escape hatch', () => {
    const root = fakeMobileRoot();
    const before = fingerprintOf(root);
    write(root, 'native/NATIVE_EPOCH', '2\n');
    expect(fingerprintOf(root)).not.toBe(before);
  });

  it('round-trips through the builtin version string the device reports', () => {
    const fingerprint = fingerprintOf(fakeMobileRoot());
    const builtin = formatBuiltinVersion('1.2.3', fingerprint, 'testing');
    expect(parseBuiltinVersion(builtin)).toEqual({ fingerprint, channel: 'testing' });
    expect(parseNativeFingerprint(builtin)).toBe(fingerprint);
    expect(parseNativeIdentity(builtin)).toEqual({
      appVersion: '1.2.3',
      fingerprint,
      channel: 'testing',
    });
    expect(parseBuiltinVersion(`1.2.3-erve-native.${fingerprint}`)).toBeNull();
  });

  it('resolves for the real repository sources', () => {
    const ota = loadOtaBuildConfig({ env: {} });
    const baseConfig = { appId: 'com.erve.mobile', appName: 'Erve', webDir: 'dist', plugins: {} };
    const { fingerprint, components } = resolveNativeIdentity({ baseConfig, ota });
    expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
    const names = components.dependencies.join(' ');
    expect(names).toContain('@capgo/capacitor-updater@');
    expect(names).toContain('@capacitor/android@');
    expect(components.template.some(([path]: [string]) => path === 'java/MainActivity.java')).toBe(
      true,
    );
    expect(components.template.some(([path]: [string]) => path.endsWith('.test.ts'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OTA build config (fail-closed)
// ---------------------------------------------------------------------------

describe('OTA build config', () => {
  const { publicKeyPem } = generateKeyPair();

  it('is disabled without a public key or URL, with a reason', () => {
    const noKey = loadOtaBuildConfig({
      mobileRoot: dir('empty'),
      env: { ERVE_OTA_BASE_URL: 'https://h/x' },
    });
    expect(noKey).toMatchObject({ enabled: false });
    expect(noKey.disabledReason).toMatch(/public key/);
    const noUrl = loadOtaBuildConfig({
      mobileRoot: dir('empty'),
      env: { ERVE_OTA_PUBLIC_KEY: publicKeyPem },
    });
    expect(noUrl.enabled).toBe(false);
    expect(noUrl.disabledReason).toMatch(/update URL/);
  });

  it('enables with a key and an https URL; derives the URL from an https /api VITE_API_URL', () => {
    const explicit = loadOtaBuildConfig({
      mobileRoot: dir('empty'),
      env: {
        ERVE_OTA_PUBLIC_KEY: publicKeyPem,
        ERVE_OTA_BASE_URL: 'https://h.example/mobile-updates/bundles/',
      },
    });
    expect(explicit).toMatchObject({
      enabled: true,
      baseUrl: 'https://h.example/mobile-updates/bundles',
    });
    const derived = loadOtaBuildConfig({
      mobileRoot: dir('empty'),
      env: { ERVE_OTA_PUBLIC_KEY: publicKeyPem, VITE_API_URL: 'https://erve.example.com/api' },
    });
    expect(derived.baseUrl).toBe('https://erve.example.com/mobile-updates/bundles');
  });

  it('refuses http unless the local-verification flag is set, and does not derive from a non-/api URL', () => {
    const env = {
      ERVE_OTA_PUBLIC_KEY: publicKeyPem,
      ERVE_OTA_BASE_URL: 'http://localhost:9/bundles',
    };
    expect(loadOtaBuildConfig({ mobileRoot: dir('empty'), env }).enabled).toBe(false);
    expect(
      loadOtaBuildConfig({
        mobileRoot: dir('empty'),
        env: { ...env, ERVE_OTA_ALLOW_INSECURE_HTTP: '1' },
      }),
    ).toMatchObject({ enabled: true, allowInsecureHttp: true });
    expect(
      loadOtaBuildConfig({
        mobileRoot: dir('empty'),
        env: { ERVE_OTA_PUBLIC_KEY: publicKeyPem, VITE_API_URL: 'https://x.example/v1' },
      }).enabled,
    ).toBe(false);
  });

  it('rejects malformed keys and channels', () => {
    expect(() =>
      loadOtaBuildConfig({ mobileRoot: dir('empty'), env: { ERVE_OTA_PUBLIC_KEY: 'nope' } }),
    ).toThrow(/PKCS#1/);
    for (const channel of ['../evil', 'staging', 'Production']) {
      expect(() =>
        loadOtaBuildConfig({ mobileRoot: dir('empty'), env: { ERVE_OTA_CHANNEL: channel } }),
      ).toThrow(/ERVE_OTA_CHANNEL/);
    }
  });

  it('configures the native updater for manual, self-hosted, authenticated operation', () => {
    const ota = loadOtaBuildConfig({
      mobileRoot: dir('empty'),
      env: { ERVE_OTA_PUBLIC_KEY: publicKeyPem, ERVE_OTA_BASE_URL: 'https://h.example/b' },
    });
    const { config } = resolveNativeIdentity({
      baseConfig: { appId: 'x', plugins: {} },
      ota,
      mobileRoot: fakeMobileRoot(),
    });
    expect(config.plugins.CapacitorUpdater).toMatchObject({
      autoUpdate: false,
      updateUrl: '',
      statsUrl: '',
      channelUrl: '',
      allowModifyUrl: false,
      httpsOnly: true,
      resetWhenUpdate: true,
      autoDeleteFailed: true,
      publicKey: publicKeyPem,
    });
    expect(config.plugins.CapacitorUpdater.appReadyTimeout).toBeGreaterThanOrEqual(10000);
  });

  it('makes an insecure-http (local verification) APK a different native layer than a production APK', () => {
    const base = { appId: 'x', plugins: {} };
    const mobileRoot = fakeMobileRoot();
    const secure = resolveNativeIdentity({
      baseConfig: base,
      mobileRoot,
      ota: loadOtaBuildConfig({
        mobileRoot: dir('empty'),
        env: { ERVE_OTA_PUBLIC_KEY: publicKeyPem, ERVE_OTA_BASE_URL: 'https://h.example/b' },
      }),
    });
    const insecure = resolveNativeIdentity({
      baseConfig: base,
      mobileRoot,
      ota: loadOtaBuildConfig({
        mobileRoot: dir('empty'),
        env: {
          ERVE_OTA_PUBLIC_KEY: publicKeyPem,
          ERVE_OTA_BASE_URL: 'http://localhost:9/b',
          ERVE_OTA_ALLOW_INSECURE_HTTP: '1',
        },
      }),
    });
    expect(insecure.fingerprint).not.toBe(secure.fingerprint);
  });

  it('a testing APK and a production APK share one native fingerprint (so tested bytes can be promoted) but report different channels', () => {
    const base = { appId: 'x', plugins: {} };
    const mobileRoot = fakeMobileRoot();
    const identity = (channel: string) =>
      resolveNativeIdentity({
        baseConfig: base,
        mobileRoot,
        ota: loadOtaBuildConfig({
          mobileRoot: dir('empty'),
          env: {
            ERVE_OTA_PUBLIC_KEY: publicKeyPem,
            ERVE_OTA_BASE_URL: 'https://h.example/b',
            ERVE_OTA_CHANNEL: channel,
          },
        }),
      });
    const testing = identity('testing');
    const production = identity('production');
    expect(testing.fingerprint).toBe(production.fingerprint);
    expect(parseBuiltinVersion(testing.builtinVersion)?.channel).toBe('testing');
    expect(parseBuiltinVersion(production.builtinVersion)?.channel).toBe('production');
    expect(testing.builtinVersion).not.toBe(production.builtinVersion);
  });
});

// ---------------------------------------------------------------------------
// Crypto: Capgo wire format and manifest signing
// ---------------------------------------------------------------------------

describe('bundle crypto (Capgo wire format)', () => {
  let pair: { publicKeyPem: string; privateKeyPem: string };
  beforeAll(() => {
    pair = generateKeyPair();
  });

  it('produces the exact shapes the native plugin demands', () => {
    const sealed = encryptBundle(Buffer.from('zip-bytes'), pair.privateKeyPem);
    expect(pair.publicKeyPem).toMatch(/^-----BEGIN RSA PUBLIC KEY-----/);
    expect(sealed.checksum).toMatch(/^[0-9a-f]{512}$/); // 256-byte RSA-2048 block
    const [iv, wrapped, ...rest] = sealed.sessionKey.split(':');
    expect(rest).toHaveLength(0);
    expect(Buffer.from(iv!, 'base64')).toHaveLength(16);
    expect(Buffer.from(wrapped!, 'base64')).toHaveLength(256);
    expect(sealed.encrypted.length % 16).toBe(0);
  });

  it('round-trips and rejects a flipped bit, a wrong key, and a swapped checksum', () => {
    const plain = Buffer.from('hello bundle '.repeat(1000));
    const sealed = encryptBundle(plain, pair.privateKeyPem);
    expect(decryptBundle(sealed.encrypted, sealed, pair.publicKeyPem).equals(plain)).toBe(true);

    const flipped = Buffer.from(sealed.encrypted);
    flipped[100] = (flipped[100]! ^ 0x01) & 0xff;
    expect(() => decryptBundle(flipped, sealed, pair.publicKeyPem)).toThrow();

    const attacker = generateKeyPair();
    const forged = encryptBundle(plain, attacker.privateKeyPem);
    expect(() => decryptBundle(forged.encrypted, forged, pair.publicKeyPem)).toThrow();

    const other = encryptBundle(Buffer.from('different'), pair.privateKeyPem);
    expect(() =>
      decryptBundle(
        sealed.encrypted,
        { sessionKey: sealed.sessionKey, checksum: other.checksum },
        pair.publicKeyPem,
      ),
    ).toThrow(/checksum/i);
  });

  it('detects mismatched key pairs', () => {
    expect(keysMatch(pair.publicKeyPem, pair.privateKeyPem)).toBe(true);
    expect(keysMatch(pair.publicKeyPem, generateKeyPair().privateKeyPem)).toBe(false);
    expect(publicKeyFromPrivate(pair.privateKeyPem)).toBe(pair.publicKeyPem);
  });
});

describe('manifest signature: Node publisher <-> app WebCrypto verifier', () => {
  const pair = generateKeyPair();
  const payload = {
    schema: 1,
    channel: 'production',
    sequence: 1,
    generatedAt: '2026-11-17T00:00:00.000Z',
    latestNativeFingerprint: 'c'.repeat(32),
    releases: {},
  };

  it('PKCS#1 -> SPKI conversion matches what Node exports', () => {
    const expected = createPublicKey(pair.publicKeyPem).export({ type: 'spki', format: 'der' });
    expect(Buffer.from(pkcs1PemToSpki(pair.publicKeyPem)).equals(expected)).toBe(true);
  });

  it('uses standard RSASSA-PKCS1-v1_5/SHA-256 (verifiable by Node too)', () => {
    const envelope = signManifest(payload, pair.privateKeyPem);
    expect(verifyManifestEnvelope(envelope, pair.publicKeyPem)).toEqual(payload);
    expect(
      createVerify('RSA-SHA256')
        .update(Buffer.from(envelope.payload, 'base64'))
        .verify(
          { key: pair.publicKeyPem, padding: constants.RSA_PKCS1_PADDING },
          Buffer.from(envelope.signature, 'base64'),
        ),
    ).toBe(true);
  });

  it('is accepted by the app verifier, and rejected when tampered or signed by another key', async () => {
    const envelope = signManifest(payload, pair.privateKeyPem);
    await expect(
      verifyAndParseManifest(envelope, pair.publicKeyPem, 'production'),
    ).resolves.toMatchObject({
      channel: 'production',
    });

    const tampered = {
      ...envelope,
      payload: Buffer.from(JSON.stringify({ ...payload, sequence: 2 })).toString('base64'),
    };
    await expect(
      verifyAndParseManifest(tampered, pair.publicKeyPem, 'production'),
    ).rejects.toMatchObject({
      code: 'signature',
    });

    const foreign = signManifest(payload, generateKeyPair().privateKeyPem);
    await expect(
      verifyAndParseManifest(foreign, pair.publicKeyPem, 'production'),
    ).rejects.toBeInstanceOf(ManifestError);
    await expect(
      verifyAndParseManifest(envelope, pair.publicKeyPem, 'staging'),
    ).rejects.toMatchObject({
      code: 'channel',
    });
    await expect(
      verifyAndParseManifest(null, pair.publicKeyPem, 'production'),
    ).rejects.toBeInstanceOf(ManifestError);
    await expect(
      verifyAndParseManifest(
        { format: 1, payload: '!!!', signature: '!!!' },
        pair.publicKeyPem,
        'production',
      ),
    ).rejects.toBeInstanceOf(ManifestError);
  });
});
