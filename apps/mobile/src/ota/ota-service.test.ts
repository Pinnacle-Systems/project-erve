import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { OtaBuildConfig } from './ota-config.js';
import { OtaStateStore, type KeyValueStorage } from './ota-state-store.js';
import { OtaUpdateService, parseNativeFingerprint, parseNativeIdentity } from './ota-service.js';
import { UpdateGuardRegistry } from './update-guards.js';
import {
  BASE_URL,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FakeUpdater,
  buildConfig,
  makeKeys,
  makePayload,
  makeRelease,
  signEnvelope,
  type TestKeys,
} from './ota-test-helpers.js';

const MANIFEST_URL = `${BASE_URL}/production/manifest.json`;

let keys: TestKeys;
beforeAll(() => {
  keys = makeKeys();
});

function memoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

interface Harness {
  service: OtaUpdateService;
  updater: FakeUpdater;
  guards: UpdateGuardRegistry;
  http: ReturnType<typeof vi.fn>;
  storage: ReturnType<typeof memoryStorage>;
  clock: { now: number };
  online: { value: boolean };
}

function harness(
  options: {
    config?: Partial<OtaBuildConfig>;
    isNative?: boolean;
    payload?: unknown;
    http?: (url: string) => Promise<{ status: number; data: unknown }>;
    updater?: FakeUpdater;
    storage?: ReturnType<typeof memoryStorage>;
  } = {},
): Harness {
  const updater = options.updater ?? new FakeUpdater();
  const guards = new UpdateGuardRegistry();
  const storage = options.storage ?? memoryStorage();
  const clock = { now: 1_800_000_000_000 };
  const online = { value: true };
  const http = vi.fn(
    options.http ??
      (async () => ({
        status: 200,
        data: signEnvelope(options.payload ?? makePayload(), keys.privateKeyPem),
      })),
  );
  const service = new OtaUpdateService({
    config: buildConfig(keys, options.config),
    updater,
    httpGetJson: http,
    store: new OtaStateStore(storage),
    guards,
    isNative: options.isNative ?? true,
    now: () => clock.now,
    isOnline: () => online.value,
  });
  return { service, updater, guards, http, storage, clock, online };
}

describe('parseNativeIdentity / parseNativeFingerprint', () => {
  it('extracts app version, fingerprint and channel from the builtin version', () => {
    const value = `0.1.0-erve-native.${FINGERPRINT_A}.production`;
    expect(parseNativeFingerprint(value)).toBe(FINGERPRINT_A);
    expect(parseNativeIdentity(value)).toEqual({
      appVersion: '0.1.0',
      fingerprint: FINGERPRINT_A,
      channel: 'production',
    });
    expect(parseNativeIdentity(`1.2.3-rc.1-erve-native.${FINGERPRINT_B}.testing`)).toEqual({
      appVersion: '1.2.3-rc.1',
      fingerprint: FINGERPRINT_B,
      channel: 'testing',
    });
  });
  it('returns null for a plain versionName, a missing or unknown channel, or garbage', () => {
    expect(parseNativeFingerprint('1.0')).toBeNull();
    expect(parseNativeFingerprint('0.1.0-erve-native.XYZ.production')).toBeNull();
    expect(parseNativeIdentity(`0.1.0-erve-native.${FINGERPRINT_A}`)).toBeNull();
    expect(parseNativeIdentity(`0.1.0-erve-native.${FINGERPRINT_A}.staging`)).toBeNull();
    expect(parseNativeIdentity(undefined)).toBeNull();
  });
});

describe('startup', () => {
  it('stays disabled and touches nothing when not running as the packaged app', async () => {
    const h = harness({ isNative: false });
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: false });
    expect(h.updater.calls).toEqual([]);
    expect(h.service.getStatus().enabled).toBe(false);
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('disabled');
    expect(h.http).not.toHaveBeenCalled();
  });

  it('disables OTA when the build has no public key / URL (fail closed)', async () => {
    const h = harness({ config: { enabled: false, disabledReason: 'no key', publicKey: '' } });
    await h.service.runStartup();
    expect(h.service.getStatus()).toMatchObject({ enabled: false, disabledReason: 'no key' });
    expect((await h.service.checkForUpdate('launch')).outcome).toBe('disabled');
    expect(h.http).not.toHaveBeenCalled();
  });

  it('disables OTA when the APK reports no native fingerprint (e.g. a foreign APK)', async () => {
    const h = harness();
    h.updater.builtinVersion = '1.0';
    await h.service.runStartup();
    expect(h.service.getStatus().enabled).toBe(false);
    expect(h.service.getStatus().disabledReason).toMatch(/fingerprint/);
  });

  it('resets to the embedded bundle when a downloaded bundle does not match the native layer', async () => {
    const h = harness({ config: { nativeFingerprint: FINGERPRINT_B } });
    h.updater.currentBundle = { id: 'b1', version: '0.1.0-ota.3', status: 'success' };
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: true });
    expect(h.updater.calls).toContain('reset');
    expect(h.service.getStatus().notice?.kind).toBe('native-mismatch');
  });

  it('does not reset when the embedded bundle itself mismatches; it just disables OTA', async () => {
    const h = harness({ config: { nativeFingerprint: FINGERPRINT_B } });
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: false });
    expect(h.updater.calls).not.toContain('reset');
    expect(h.service.getStatus().enabled).toBe(false);
  });

  it('disables OTA when the APK reports no release channel (never guesses one)', async () => {
    const h = harness();
    h.updater.builtinVersion = `0.1.0-erve-native.${FINGERPRINT_A}`;
    await h.service.runStartup();
    expect(h.service.getStatus().enabled).toBe(false);
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('disabled');
    expect(h.http).not.toHaveBeenCalled();
  });

  it('reports the installed app version, native build and channel in the status', async () => {
    const h = harness();
    await h.service.runStartup();
    expect(h.service.getStatus()).toMatchObject({
      channel: 'production',
      native: { appVersion: '0.1.0', fingerprint: FINGERPRINT_A },
    });
  });

  it('reads the running bundle version and build number', async () => {
    const h = harness();
    h.updater.currentBundle = { id: 'b1', version: '0.1.0-ota.7', status: 'success' };
    await h.service.runStartup();
    expect(h.service.getStatus()).toMatchObject({
      currentVersion: '0.1.0-ota.7',
      currentBuildNumber: 7,
    });
  });

  it('records a rolled-back bundle, remembers the build as failed, and tells the user once', async () => {
    const h = harness({ payload: makePayload({ releases: { [FINGERPRINT_A]: makeRelease(5) } }) });
    h.updater.failed = { id: 'bad', version: '0.1.0-ota.5', status: 'error' };
    await h.service.runStartup();
    expect(h.service.getStatus().notice).toMatchObject({
      kind: 'rolled-back',
      version: '0.1.0-ota.5',
    });

    const check = await h.service.checkForUpdate('manual');
    expect(check.outcome).toBe('skipped');
    expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);

    h.service.dismissNotice();
    expect(h.service.getStatus().notice).toBeNull();
  });

  it('activates a previously staged bundle at cold start when nothing blocks it', async () => {
    const h = harness();
    h.updater.bundles = [{ id: 'staged', version: '0.1.0-ota.9', status: 'pending' }];
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: true });
    expect(h.updater.calls).toContain('set:staged');
  });

  it('does not activate a staged bundle at startup when a guard objects', async () => {
    const h = harness();
    h.guards.hold('A QA inspection is open');
    h.updater.bundles = [{ id: 'staged', version: '0.1.0-ota.9', status: 'pending' }];
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: false });
    expect(h.updater.calls).not.toContain('set:staged');
    expect(h.service.getStatus()).toMatchObject({
      staged: { bundleId: 'staged', buildNumber: 9 },
      blockedBy: 'A QA inspection is open',
    });
  });

  it('ignores staged bundles that are not newer than the running one or that failed before', async () => {
    const h = harness();
    h.updater.currentBundle = { id: 'cur', version: '0.1.0-ota.8', status: 'success' };
    h.updater.bundles = [
      { id: 'old', version: '0.1.0-ota.8', status: 'pending' },
      { id: 'older', version: '0.1.0-ota.2', status: 'pending' },
    ];
    await expect(h.service.runStartup()).resolves.toEqual({ reloading: false });
    expect(h.service.getStatus().staged).toBeNull();
    expect(h.updater.calls).toEqual(expect.arrayContaining(['delete:old', 'delete:older']));
  });

  it('cleans up interrupted downloads but leaves the rollback target alone while the current bundle is unconfirmed', async () => {
    const confirmed = harness();
    confirmed.updater.currentBundle = { id: 'cur', version: '0.1.0-ota.8', status: 'success' };
    confirmed.updater.bundles = [{ id: 'half', version: '0.1.0-ota.9', status: 'downloading' }];
    await confirmed.service.runStartup();
    expect(confirmed.updater.calls).toContain('delete:half');

    const unconfirmed = harness();
    unconfirmed.updater.currentBundle = { id: 'cur', version: '0.1.0-ota.9', status: 'pending' };
    unconfirmed.updater.bundles = [{ id: 'prev', version: '0.1.0-ota.8', status: 'success' }];
    await unconfirmed.service.runStartup();
    expect(unconfirmed.updater.calls.filter((call) => call.startsWith('delete'))).toEqual([]);
  });

  it('never blocks launch when the plugin hangs', async () => {
    const updater = new FakeUpdater();
    updater.getBuiltinVersion = () => new Promise(() => undefined);
    const service = new OtaUpdateService({
      config: buildConfig(keys),
      updater,
      httpGetJson: vi.fn(),
      store: new OtaStateStore(memoryStorage()),
      guards: new UpdateGuardRegistry(),
      isNative: true,
      startupBudgetMs: 20,
    });
    await expect(service.runStartup()).resolves.toEqual({ reloading: false });
  });

  it('markReady confirms the bundle to the native updater', async () => {
    const h = harness();
    await h.service.markReady();
    expect(h.updater.calls).toEqual(['notifyAppReady']);
  });
});

describe('checking and staging', () => {
  async function ready(options: Parameters<typeof harness>[0] = {}) {
    const h = harness(options);
    await h.service.runStartup();
    return h;
  }

  it('fetches the signed manifest for its channel and reports up-to-date when nothing is newer', async () => {
    const updater = new FakeUpdater();
    updater.currentBundle = { id: 'cur', version: '0.1.0-ota.5', status: 'success' };
    const h = await ready({ updater });
    const result = await h.service.checkForUpdate('manual');
    expect(h.http.mock.calls[0]?.[0]).toBe(MANIFEST_URL);
    expect(result.outcome).toBe('up-to-date');
    expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
  });

  it('downloads a newer compatible release and only STAGES it (never activates it)', async () => {
    const h = await ready();
    const result = await h.service.checkForUpdate('launch');
    expect(result.outcome).toBe('update-staged');
    expect(h.updater.lastDownload).toEqual({
      url: `${BASE_URL}/production/${FINGERPRINT_A}/5.bundle`,
      version: '0.1.0-ota.5',
      checksum: 'ab'.repeat(256),
      sessionKey: 'aXY=:a2V5',
    });
    expect(h.updater.calls.some((call) => call.startsWith('set:'))).toBe(false);
    expect(h.service.getStatus().staged).toMatchObject({ buildNumber: 5 });
    expect(h.service.getStatus().phase).toBe('idle');
  });

  it('does not re-download an update that is already staged', async () => {
    const h = await ready();
    await h.service.checkForUpdate('manual');
    await h.service.checkForUpdate('manual');
    expect(h.updater.calls.filter((call) => call.startsWith('download'))).toHaveLength(1);
  });

  it('replaces a staged update with a newer one and deletes the superseded bundle', async () => {
    const h = await ready();
    await h.service.checkForUpdate('manual');
    h.http.mockResolvedValueOnce({
      status: 200,
      data: signEnvelope(
        makePayload({
          sequence: 2_000,
          releases: { [FINGERPRINT_A]: makeRelease(6) },
        }),
        keys.privateKeyPem,
      ),
    });
    await h.service.checkForUpdate('manual');
    expect(h.service.getStatus().staged?.buildNumber).toBe(6);
    expect(h.updater.calls).toContain('delete:bundle-1');
  });

  it('never installs a build that is not newer than the running one (rollback/replay)', async () => {
    const h = harness({ payload: makePayload({ releases: { [FINGERPRINT_A]: makeRelease(5) } }) });
    h.updater.currentBundle = { id: 'cur', version: '0.1.0-ota.5', status: 'success' };
    await h.service.runStartup();
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('up-to-date');
    expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
  });

  it('ignores releases for a different native layer and says a new APK is needed', async () => {
    const h = await ready({
      payload: makePayload({
        latestNativeFingerprint: FINGERPRINT_B,
        releases: { [FINGERPRINT_B]: makeRelease(9, { url: `${FINGERPRINT_B}/9.bundle` }) },
      }),
    });
    const result = await h.service.checkForUpdate('manual');
    expect(result.outcome).toBe('native-update-required');
    expect(h.service.getStatus()).toMatchObject({
      nativeUpdateRequired: true,
      newerApkAvailable: true,
    });
    expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
  });

  it('does not tell a NEWER APK (installed before its first release exists) to install an app it already has', async () => {
    const h = harness({
      payload: makePayload({
        latestNativeFingerprint: FINGERPRINT_B,
        releases: { [FINGERPRINT_B]: makeRelease(9, { url: `${FINGERPRINT_B}/9.bundle` }) },
      }),
    });
    // The manifest's only generation was published under app 0.1.0; this device is 0.2.0.
    h.updater.builtinVersion = `0.2.0-erve-native.${FINGERPRINT_A}.production`;
    await h.service.runStartup();
    const result = await h.service.checkForUpdate('manual');
    expect(result.outcome).toBe('up-to-date');
    expect(h.service.getStatus()).toMatchObject({
      nativeUpdateRequired: false,
      newerApkAvailable: false,
    });
    expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
  });

  it('still says a new APK is needed when the other generation is newer or the versions cannot be ordered', async () => {
    for (const device of ['0.0.9', '0.1.0']) {
      const h = harness({
        payload: makePayload({
          latestNativeFingerprint: FINGERPRINT_B,
          releases: { [FINGERPRINT_B]: makeRelease(9, { url: `${FINGERPRINT_B}/9.bundle` }) },
        }),
      });
      h.updater.builtinVersion = `${device}-erve-native.${FINGERPRINT_A}.production`;
      await h.service.runStartup();
      expect((await h.service.checkForUpdate('manual')).outcome, device).toBe(
        'native-update-required',
      );
    }
  });

  it('keeps updating an older APK generation while flagging that a newer APK exists', async () => {
    const h = await ready({
      payload: makePayload({
        latestNativeFingerprint: FINGERPRINT_B,
        releases: {
          [FINGERPRINT_A]: makeRelease(5),
          [FINGERPRINT_B]: makeRelease(9, { url: `${FINGERPRINT_B}/9.bundle` }),
        },
      }),
    });
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('update-staged');
    expect(h.service.getStatus()).toMatchObject({
      nativeUpdateRequired: false,
      newerApkAvailable: true,
    });
  });

  describe('network and server failures never break the app', () => {
    it('reports offline without touching the network', async () => {
      const h = await ready();
      h.online.value = false;
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('offline');
      expect(h.http).not.toHaveBeenCalled();
    });

    it('reports an unreachable server', async () => {
      const h = await ready({
        http: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      });
      const result = await h.service.checkForUpdate('manual');
      expect(result.outcome).toBe('server-unavailable');
      expect(result.message).toMatch(/update server/i);
    });

    it('reports offline when the failure coincides with losing connectivity', async () => {
      const h = await ready();
      h.http.mockImplementationOnce(async () => {
        h.online.value = false;
        throw new Error('network down');
      });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('offline');
    });

    it.each([500, 502, 503, 429, 403])('treats HTTP %i as server-unavailable', async (status) => {
      const h = await ready({ http: async () => ({ status, data: 'nope' }) });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('server-unavailable');
    });

    it('treats a missing manifest (404) as "nothing published yet"', async () => {
      const h = await ready({ http: async () => ({ status: 404, data: '' }) });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('up-to-date');
    });

    it('persists the last check so the UI can show it after a restart', async () => {
      const storage = memoryStorage();
      const h = await ready({ storage, http: async () => ({ status: 503, data: '' }) });
      await h.service.checkForUpdate('manual');
      const reopened = harness({ storage });
      expect(reopened.service.getStatus().lastCheck?.outcome).toBe('server-unavailable');
    });

    it('survives unusable storage', async () => {
      const broken: KeyValueStorage = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      };
      const store = new OtaStateStore(broken);
      store.markFailedBuild(3);
      expect(store.isFailedBuild(3)).toBe(true);
    });
  });

  describe('manifest authenticity', () => {
    it('rejects a manifest signed by a different key and downloads nothing', async () => {
      const attacker = makeKeys();
      const h = await ready({
        http: async () => ({
          status: 200,
          data: signEnvelope(makePayload(), attacker.privateKeyPem),
        }),
      });
      const result = await h.service.checkForUpdate('manual');
      expect(result.outcome).toBe('invalid-manifest');
      expect(result.message).toMatch(/signature/);
      expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
    });

    it('rejects a manifest whose payload was altered after signing', async () => {
      const envelope = signEnvelope(makePayload(), keys.privateKeyPem);
      const tampered = {
        ...envelope,
        payload: Buffer.from(
          JSON.stringify(makePayload({ releases: { [FINGERPRINT_A]: makeRelease(99) } })),
        ).toString('base64'),
      };
      const h = await ready({ http: async () => ({ status: 200, data: tampered }) });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
      expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
    });

    it('rejects a validly signed manifest for another channel', async () => {
      const h = await ready({ payload: makePayload({ channel: 'staging' }) });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    });

    it('rejects garbage and HTML error pages served with 200', async () => {
      const h = await ready({
        http: async () => ({ status: 200, data: '<html>captive portal</html>' }),
      });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    });

    it('rejects an older manifest than one already seen (manifest replay)', async () => {
      const h = await ready({ payload: makePayload({ sequence: 5_000 }) });
      await h.service.checkForUpdate('manual');
      h.http.mockResolvedValueOnce({
        status: 200,
        data: signEnvelope(makePayload({ sequence: 4_000 }), keys.privateKeyPem),
      });
      const result = await h.service.checkForUpdate('manual');
      expect(result.outcome).toBe('invalid-manifest');
      expect(result.message).toMatch(/older/);
    });

    it.each([
      ['plain http', 'http://erve.example.test/mobile-updates/bundles/x.bundle'],
      ['another origin', 'https://evil.example.test/x.bundle'],
      ['embedded credentials', 'https://user:pw@erve.example.test/x.bundle'],
    ])('refuses a release URL with %s', async (_label, url) => {
      const h = await ready({
        payload: makePayload({ releases: { [FINGERPRINT_A]: makeRelease(5, { url }) } }),
      });
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
      expect(h.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
    });
  });

  describe('download failures', () => {
    it('reports a verification failure distinctly and does not stage anything', async () => {
      const h = await ready();
      h.updater.downloadError = new Error('Checksum failed: abc');
      const result = await h.service.checkForUpdate('manual');
      expect(result.outcome).toBe('download-failed');
      expect(result.message).toMatch(/verification/);
      expect(h.service.getStatus().staged).toBeNull();
    });

    it('reports a dropped connection mid-download as offline', async () => {
      const h = await ready();
      h.updater.downloadError = new Error('Failed to download');
      h.updater.download = async () => {
        h.online.value = false;
        throw new Error('Failed to download');
      };
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('offline');
    });

    it('backs off after repeated failures of the same build, then retries later', async () => {
      const h = await ready();
      h.updater.downloadError = new Error('Failed to download');
      for (let attempt = 0; attempt < 3; attempt += 1) await h.service.checkForUpdate('manual');
      expect(h.updater.calls.filter((call) => call.startsWith('download'))).toHaveLength(3);
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('skipped');
      expect(h.updater.calls.filter((call) => call.startsWith('download'))).toHaveLength(3);

      h.clock.now += 7 * 60 * 60_000;
      h.updater.downloadError = null;
      expect((await h.service.checkForUpdate('manual')).outcome).toBe('update-staged');
    });

    it('gives up on a download that never finishes', async () => {
      const updater = new FakeUpdater();
      updater.downloadGate = new Promise(() => undefined);
      const service = new OtaUpdateService({
        config: buildConfig(keys),
        updater,
        httpGetJson: async () => ({
          status: 200,
          data: signEnvelope(makePayload(), keys.privateKeyPem),
        }),
        store: new OtaStateStore(memoryStorage()),
        guards: new UpdateGuardRegistry(),
        isNative: true,
        downloadTimeoutMs: 25,
      });
      await service.runStartup();
      const result = await service.checkForUpdate('manual');
      expect(result.outcome).toBe('download-failed');
      expect(service.getStatus().phase).toBe('idle');
    });
  });

  describe('scheduling', () => {
    it('runs one check at a time', async () => {
      const h = await ready();
      await Promise.all([h.service.checkForUpdate('launch'), h.service.checkForUpdate('resume')]);
      expect(h.http).toHaveBeenCalledTimes(1);
    });

    it('throttles automatic checks but never manual ones', async () => {
      const h = await ready();
      await h.service.checkForUpdate('resume');
      await h.service.checkForUpdate('resume');
      expect(h.http).toHaveBeenCalledTimes(1);
      await h.service.checkForUpdate('manual');
      expect(h.http).toHaveBeenCalledTimes(2);
      h.clock.now += 6 * 60_000;
      await h.service.checkForUpdate('resume');
      expect(h.http).toHaveBeenCalledTimes(3);
    });
  });
});

describe('safe activation', () => {
  async function staged() {
    const h = harness();
    await h.service.runStartup();
    await h.service.checkForUpdate('manual');
    return h;
  }

  it.each(['A QA inspection is open', 'A save is in progress', 'A form has unsaved changes'])(
    'refuses to activate while a guard reports "%s"',
    async (reason) => {
      const h = await staged();
      const release = h.guards.hold(reason);
      await expect(h.service.activateStagedIfSafe()).resolves.toBe(false);
      expect(h.updater.calls.some((call) => call.startsWith('set:'))).toBe(false);
      expect(h.service.getStatus().blockedBy).toBe(reason);

      release();
      h.service.refreshGuardState();
      expect(h.service.getStatus().blockedBy).toBeNull();
      await expect(h.service.activateStagedIfSafe()).resolves.toBe(true);
      expect(h.updater.calls).toContain('set:bundle-1');
    },
  );

  it('treats a throwing guard as unsafe (never reload blind)', async () => {
    const h = await staged();
    h.guards.register(() => {
      throw new Error('boom');
    });
    await expect(h.service.activateStagedIfSafe()).resolves.toBe(false);
  });

  it('does nothing when no update is staged', async () => {
    const h = harness();
    await h.service.runStartup();
    await expect(h.service.activateStagedIfSafe()).resolves.toBe(false);
  });

  it('on resume: activates a staged update if safe, without starting another check', async () => {
    const h = await staged();
    const checks = h.http.mock.calls.length;
    await h.service.onResume();
    expect(h.updater.calls).toContain('set:bundle-1');
    expect(h.http.mock.calls.length).toBe(checks);
  });

  it('on resume: keeps the update staged and checks for newer ones when blocked', async () => {
    const h = await staged();
    h.guards.hold('A QA inspection is open');
    h.clock.now += 10 * 60_000;
    await h.service.onResume();
    expect(h.updater.calls.some((call) => call.startsWith('set:'))).toBe(false);
    expect(h.service.getStatus().staged).not.toBeNull();
    expect(h.http).toHaveBeenCalledTimes(2);
  });

  it('on resume with no update staged: just checks', async () => {
    const h = harness({ payload: makePayload({ releases: {} }) });
    await h.service.runStartup();
    await h.service.onResume();
    expect(h.http).toHaveBeenCalledTimes(1);
  });

  it('a failed activation marks the build failed, removes it and warns the user', async () => {
    const h = await staged();
    h.updater.setError = new Error('bundle is corrupt');
    await expect(h.service.activateStagedIfSafe()).resolves.toBe(false);
    expect(h.updater.calls).toContain('delete:bundle-1');
    expect(h.service.getStatus()).toMatchObject({ staged: null, phase: 'idle' });
    expect(h.service.getStatus().notice?.kind).toBe('activation-failed');
    // ...and the same build is not fetched again.
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('skipped');
  });
});

describe('activation ledger (crash-loop protection)', () => {
  it('records the attempt before reloading', async () => {
    const h = harness();
    await h.service.runStartup();
    await h.service.checkForUpdate('manual');
    await h.service.activateStagedIfSafe();
    expect(JSON.parse(h.storage.data['erve.ota.state.v1']!).pendingActivation).toMatchObject({
      buildNumber: 5,
      version: '0.1.0-ota.5',
    });
  });

  it('detects a bundle that never became healthy (silent native rollback) and never retries it', async () => {
    const first = harness();
    await first.service.runStartup();
    await first.service.checkForUpdate('manual');
    await first.service.activateStagedIfSafe();

    // The page reloads into the embedded/previous bundle; the plugin reports nothing.
    const reopened = harness({ storage: first.storage });
    await reopened.service.runStartup();
    expect(reopened.service.getStatus().notice).toMatchObject({
      kind: 'rolled-back',
      version: '0.1.0-ota.5',
    });
    expect(JSON.parse(first.storage.data['erve.ota.state.v1']!)).toMatchObject({
      failedBuilds: [5],
      pendingActivation: null,
    });
    reopened.service.dismissNotice();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      reopened.clock.now += 10 * 60_000;
      expect((await reopened.service.checkForUpdate('resume')).outcome).toBe('skipped');
    }
    expect(reopened.updater.calls.some((call) => call.startsWith('download'))).toBe(false);
  });

  it('a healthy bundle clears the ledger on markReady and is not flagged', async () => {
    const first = harness();
    await first.service.runStartup();
    await first.service.checkForUpdate('manual');
    await first.service.activateStagedIfSafe();

    const updater = new FakeUpdater();
    updater.currentBundle = { id: 'bundle-1', version: '0.1.0-ota.5', status: 'pending' };
    const running = harness({ storage: first.storage, updater });
    await running.service.runStartup();
    expect(running.service.getStatus().notice).toBeNull();
    await running.service.markReady();
    expect(JSON.parse(first.storage.data['erve.ota.state.v1']!).pendingActivation).toBeNull();

    const later = harness({
      storage: first.storage,
      updater: Object.assign(new FakeUpdater(), { currentBundle: updater.currentBundle }),
    });
    await later.service.runStartup();
    expect(later.service.getStatus().notice).toBeNull();
    expect(JSON.parse(first.storage.data['erve.ota.state.v1']!).failedBuilds).toEqual([]);
  });

  it('keeps the ledger if the new bundle crashes before markReady, so the NEXT startup flags it', async () => {
    const first = harness();
    await first.service.runStartup();
    await first.service.checkForUpdate('manual');
    await first.service.activateStagedIfSafe();

    const updater = new FakeUpdater();
    updater.currentBundle = { id: 'bundle-1', version: '0.1.0-ota.5', status: 'pending' };
    const crashing = harness({ storage: first.storage, updater });
    await crashing.service.runStartup(); // never reaches markReady
    expect(JSON.parse(first.storage.data['erve.ota.state.v1']!).pendingActivation).not.toBeNull();

    const afterRollback = harness({ storage: first.storage });
    await afterRollback.service.runStartup();
    expect(afterRollback.service.getStatus().notice?.kind).toBe('rolled-back');
  });

  it('clears the ledger when set() itself rejects', async () => {
    const h = harness();
    await h.service.runStartup();
    await h.service.checkForUpdate('manual');
    h.updater.setError = new Error('nope');
    await h.service.activateStagedIfSafe();
    expect(JSON.parse(h.storage.data['erve.ota.state.v1']!).pendingActivation).toBeNull();
  });
});

describe('release channels (the channel comes from the APK, not the bundle)', () => {
  async function onChannel(channel: string, payload: unknown) {
    const updater = new FakeUpdater();
    updater.builtinVersion = `0.1.0-erve-native.${FINGERPRINT_A}.${channel}`;
    const h = harness({ updater, payload });
    await h.service.runStartup();
    return h;
  }

  it('a testing APK reads only the testing manifest and a production APK only the production one', async () => {
    const testing = await onChannel('testing', makePayload({ channel: 'testing' }));
    await testing.service.checkForUpdate('manual');
    expect(testing.http).toHaveBeenCalledWith(
      `${BASE_URL}/testing/manifest.json`,
      expect.anything(),
    );

    const production = await onChannel('production', makePayload());
    await production.service.checkForUpdate('manual');
    expect(production.http).toHaveBeenCalledWith(MANIFEST_URL, expect.anything());
  });

  it('refuses a validly signed production manifest served to a testing APK (and vice versa)', async () => {
    const testing = await onChannel('testing', makePayload({ channel: 'production' }));
    expect((await testing.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    expect(testing.updater.calls.some((c) => c.startsWith('download'))).toBe(false);

    const production = await onChannel('production', makePayload({ channel: 'testing' }));
    expect((await production.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    expect(production.updater.calls.some((c) => c.startsWith('download'))).toBe(false);
  });
});

describe('emergency rollback release (old content, NEW build number and sequence)', () => {
  it('moves a device that installed the bad build forward onto the rolled-back content', async () => {
    const updater = new FakeUpdater();
    // The device is running build 7, which turned out to be bad.
    updater.currentBundle = { id: 'bad', version: '0.1.0-ota.7', status: 'success' };
    const h = harness({
      updater,
      payload: makePayload({
        sequence: 2_000,
        releases: { [FINGERPRINT_A]: makeRelease(8, { version: '0.1.0-ota.8' }) },
      }),
    });
    await h.service.runStartup();
    expect((await h.service.checkForUpdate('manual')).outcome).toBe('update-staged');
    expect(updater.lastDownload?.version).toBe('0.1.0-ota.8');
  });

  it('is rejected when its manifest sequence is not higher than one already seen', async () => {
    const h = await onSeen(3_000);
    h.http.mockResolvedValueOnce({
      status: 200,
      data: signEnvelope(
        makePayload({ sequence: 2_500, releases: { [FINGERPRINT_A]: makeRelease(9) } }),
        keys.privateKeyPem,
      ),
    });
    const result = await h.service.checkForUpdate('manual');
    expect(result.outcome).toBe('invalid-manifest');
  });

  async function onSeen(sequence: number) {
    const h = harness({ payload: makePayload({ sequence }) });
    await h.service.runStartup();
    await h.service.checkForUpdate('manual');
    return h;
  }
});
