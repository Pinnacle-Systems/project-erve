import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  evaluateRelease,
  isLocalUrl,
  normaliseDigest,
  parseBadging,
  parseManifestNetworkFacts,
  readEmbeddedInfo,
  parseSignerDigests,
  parseSignerSubjects,
  readOtaIdentity,
} from './apk-check.mjs';

const DIGEST_A = '9f29063360a517d8ac7118ab97447b6337a0b9b306f1f9ce31fe21b1c81788a4';
const DIGEST_B = 'aa'.repeat(32);
const FP = '70e1a5a357692f91363ebaaf11295cde';
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0B\nAQEFAAOCAQ8A\n-----END PUBLIC KEY-----\n';

// Real `apksigner verify --print-certs` / `aapt2 dump badging` output shapes.
const APKSIGNER_V3 = `V3.0 Signer: certificate DN: CN=Erve RC Disposable, O=Test
V3.0 Signer: certificate SHA-256 digest: ${DIGEST_A}
`;
const APKSIGNER_V2_V3 = `Signer #1 certificate DN: CN=Erve RC Disposable, O=Test
Signer #1 certificate SHA-256 digest: ${DIGEST_A.toUpperCase()}
Signer #1 certificate SHA-1 digest: 1111111111111111111111111111111111111111
V3.0 Signer: certificate SHA-256 digest: ${DIGEST_A}
`;
const badging = (code: number, name: string, debuggable = false) =>
  `package: name='com.erve.mobile' versionCode='${code}' versionName='${name}' platformBuildVersionName='16'\n` +
  (debuggable ? 'application-debuggable\n' : '') +
  "sdkVersion:'24'\n";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    digests: [DIGEST_A],
    subjects: ['CN=Erve RC Disposable, O=Test'],
    badging: parseBadging(badging(201, '0.2.1')),
    ota: {
      present: true,
      appVersion: '0.2.1',
      fingerprint: FP,
      channel: 'production',
      publicKey: PUBLIC_KEY,
    },
    ...overrides,
  };
}
const previous = (versionCode = 100) => ({
  digests: [DIGEST_A],
  badging: parseBadging(badging(versionCode, '0.1.0')),
});

describe('parsers', () => {
  it('reads signer digests from v3-only and v2+v3 output, de-duplicated and lower-cased', () => {
    expect(parseSignerDigests(APKSIGNER_V3)).toEqual([DIGEST_A]);
    expect(parseSignerDigests(APKSIGNER_V2_V3)).toEqual([DIGEST_A]);
    expect(parseSignerDigests('Verifies')).toEqual([]);
  });

  it('reads signer subjects', () => {
    expect(parseSignerSubjects(APKSIGNER_V3)).toEqual(['CN=Erve RC Disposable, O=Test']);
  });

  it('reads package, version and the debuggable flag from badging', () => {
    expect(parseBadging(badging(201, '0.2.1'))).toEqual({
      packageName: 'com.erve.mobile',
      versionCode: 201,
      versionName: '0.2.1',
      debuggable: false,
    });
    expect(parseBadging(badging(1, '1.0', true)).debuggable).toBe(true);
    expect(parseBadging('garbage')).toMatchObject({ packageName: null, versionCode: null });
  });

  it('accepts colon-separated fingerprints (as printed by keytool) and rejects malformed ones', () => {
    const colons = DIGEST_A.match(/../g)!.join(':').toUpperCase();
    expect(normaliseDigest(colons)).toBe(DIGEST_A);
    expect(() => normaliseDigest('9f:29:06')).toThrow(/SHA-256/);
  });

  it('reads the OTA identity baked into the APK', () => {
    const config = {
      plugins: {
        CapacitorUpdater: { version: `0.2.1-erve-native.${FP}.production`, publicKey: PUBLIC_KEY },
      },
    };
    const apk = zipSync({
      'assets/capacitor.config.json': new TextEncoder().encode(JSON.stringify(config)),
      'classes.dex': new Uint8Array([1, 2, 3]),
    });
    expect(readOtaIdentity(apk)).toMatchObject({
      present: true,
      appVersion: '0.2.1',
      fingerprint: FP,
      channel: 'production',
    });
    expect(readOtaIdentity(zipSync({ 'classes.dex': new Uint8Array([1]) }))).toEqual({
      present: false,
    });
    const preOta = zipSync({
      'assets/capacitor.config.json': new TextEncoder().encode(JSON.stringify({ plugins: {} })),
    });
    expect(readOtaIdentity(preOta).present).toBe(false);
  });
});

describe('evaluateRelease', () => {
  it('accepts a correctly signed, higher-versioned, release-grade APK for the right channel', () => {
    const result = evaluateRelease(candidate(), {
      previous: previous(),
      channel: 'production',
      otaPublicKeyPem: PUBLIC_KEY,
    });
    expect(result).toEqual({ ok: true, problems: [], warnings: [] });
  });

  it('REFUSES an APK signed with a different certificate (users would have to uninstall)', () => {
    const result = evaluateRelease(candidate({ digests: [DIGEST_B], subjects: ['CN=Other'] }), {
      previous: previous(),
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/Signing identity differs.*uninstall/);
  });

  it('refuses an APK that has the right certificate PLUS an extra one (an unreviewed signer)', () => {
    const result = evaluateRelease(candidate({ digests: [DIGEST_A, DIGEST_B] }), {
      previous: previous(),
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a recorded fingerprint instead of a previous APK', () => {
    const result = evaluateRelease(candidate(), { expectedDigests: [DIGEST_A] });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/versionCode ordering was NOT checked/);
    expect(evaluateRelease(candidate(), { expectedDigests: [DIGEST_B] }).ok).toBe(false);
  });

  it('fails closed when there is nothing to compare the signing identity against', () => {
    const result = evaluateRelease(candidate(), {});
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/NOT checked/);
    expect(evaluateRelease(candidate(), { allowUnchecked: true }).ok).toBe(true);
  });

  it('refuses a version that is not higher than the distributed one', () => {
    expect(evaluateRelease(candidate(), { previous: previous(201) }).ok).toBe(false);
    expect(evaluateRelease(candidate(), { previous: previous(300) }).ok).toBe(false);
    expect(evaluateRelease(candidate(), { previous: previous(200) }).ok).toBe(true);
  });

  it('refuses debuggable builds and builds signed with the Android debug key', () => {
    const debuggable = candidate({ badging: parseBadging(badging(201, '0.2.1', true)) });
    expect(evaluateRelease(debuggable, { previous: previous() }).problems.join(' ')).toMatch(
      /debuggable/,
    );
    const debugKey = candidate({ subjects: ['C=US, O=Android, CN=Android Debug'] });
    expect(evaluateRelease(debugKey, { previous: previous() }).problems.join(' ')).toMatch(
      /DEBUG key/,
    );
    expect(evaluateRelease(debuggable, { previous: previous(), allowDebug: true }).ok).toBe(true);
  });

  it('refuses the wrong package, an unsigned APK and a malformed OTA identity', () => {
    const wrongPackage = candidate({
      badging: {
        packageName: 'com.other',
        versionCode: 201,
        versionName: '0.2.1',
        debuggable: false,
      },
    });
    expect(evaluateRelease(wrongPackage, { previous: previous() }).ok).toBe(false);
    expect(evaluateRelease(candidate({ digests: [] }), { previous: previous() }).ok).toBe(false);
    const malformed = candidate({ ota: { present: true, fingerprint: null, channel: null } });
    expect(evaluateRelease(malformed, { previous: previous() }).ok).toBe(false);
  });

  it('refuses the wrong channel, a different OTA public key, and disagreeing versions', () => {
    const base = { previous: previous() };
    expect(evaluateRelease(candidate(), { ...base, channel: 'testing' }).ok).toBe(false);
    expect(
      evaluateRelease(candidate(), {
        ...base,
        otaPublicKeyPem: PUBLIC_KEY.replace('MIIB', 'MIIC'),
      }).problems.join(' '),
    ).toMatch(/not the committed public key/);
    const disagreeing = candidate({
      ota: {
        present: true,
        appVersion: '0.2.0',
        fingerprint: FP,
        channel: 'production',
        publicKey: PUBLIC_KEY,
      },
    });
    expect(evaluateRelease(disagreeing, base).problems.join(' ')).toMatch(/disagree/);
  });

  it('only warns for a pre-OTA APK (it simply has no updater)', () => {
    const result = evaluateRelease(candidate({ ota: { present: false } }), {
      previous: previous(),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/pre-OTA/);
  });
});

describe('embedded test-build leftovers', () => {
  const js = (url: string) =>
    new TextEncoder().encode(`var c={enabled:!0,baseUrl:\`${url}\`,allowInsecureHttp:!1}`);

  it('finds bundled certificates (even under AGP-shortened paths) and the baked-in OTA URL', () => {
    const apk = zipSync({
      'res/Px.pem': new Uint8Array([1]),
      'res/raw/other.crt': new Uint8Array([2]),
      'assets/public/assets/index-abc.js': js('https://localhost:8443/mobile-updates/bundles'),
      'classes.dex': new Uint8Array([3]),
    });
    expect(readEmbeddedInfo(apk)).toEqual({
      bundledCertificates: ['res/Px.pem', 'res/raw/other.crt'],
      otaBaseUrls: ['https://localhost:8443/mobile-updates/bundles'],
    });
    expect(readEmbeddedInfo(zipSync({ 'classes.dex': new Uint8Array([1]) }))).toEqual({
      bundledCertificates: [],
      otaBaseUrls: [],
    });
  });

  it('reads the network attributes of the compiled manifest', () => {
    const withConfig =
      '        A: http://schemas.android.com/apk/res/android:networkSecurityConfig(0x01010527)=@0x7f110002';
    const cleartext =
      '        A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=(type 0x12)0xffffffff';
    expect(parseManifestNetworkFacts(withConfig)).toEqual({
      manifestNetworkConfig: true,
      usesCleartextTraffic: false,
    });
    expect(parseManifestNetworkFacts(cleartext).usesCleartextTraffic).toBe(true);
    expect(parseManifestNetworkFacts('A: name="x"')).toEqual({
      manifestNetworkConfig: false,
      usesCleartextTraffic: false,
    });
  });

  it('classifies update URLs', () => {
    for (const local of [
      'https://localhost:8443/x',
      'https://127.0.0.1/x',
      'https://10.0.2.2:8443/x',
      'https://erve.local/x',
      'not a url',
    ]) {
      expect(isLocalUrl(local), local).toBe(true);
    }
    expect(isLocalUrl('https://erve.example.com/mobile-updates/bundles')).toBe(false);
  });

  const clean = {
    bundledCertificates: [],
    otaBaseUrls: ['https://erve.example.com/mobile-updates/bundles'],
  };

  it('accepts a clean production embedding', () => {
    expect(evaluateRelease(candidate({ embedded: clean }), { previous: previous() }).ok).toBe(true);
  });

  it('REFUSES a custom network security config or bundled certificate (a trusted test CA)', () => {
    const viaManifest = candidate({ embedded: { ...clean, manifestNetworkConfig: true } });
    const viaCert = candidate({ embedded: { ...clean, bundledCertificates: ['res/Px.pem'] } });
    for (const apk of [viaManifest, viaCert]) {
      const result = evaluateRelease(apk, { previous: previous() });
      expect(result.ok).toBe(false);
      expect(result.problems.join(' ')).toMatch(/trusts?|test CA/);
    }
    expect(evaluateRelease(viaCert, { previous: previous(), allowNetworkConfig: true }).ok).toBe(
      true,
    );
  });

  it('refuses cleartext traffic and non-public or non-https OTA URLs', () => {
    expect(
      evaluateRelease(candidate({ embedded: { ...clean, usesCleartextTraffic: true } }), {
        previous: previous(),
      }).ok,
    ).toBe(false);
    for (const url of ['https://localhost:8443/m', 'http://erve.example.com/m']) {
      const bad = candidate({ embedded: { ...clean, otaBaseUrls: [url] } });
      expect(evaluateRelease(bad, { previous: previous() }).ok, url).toBe(false);
      expect(evaluateRelease(bad, { previous: previous(), allowLocalUrls: true }).ok, url).toBe(
        true,
      );
    }
  });
});
