/**
 * End-to-end release flow over REAL HTTPS with disposable keys:
 *
 *   workstation release tree --sync--> server directory --HTTPS--> device
 *
 * The server mimics the nginx locations in deployment/nginx (static files only,
 * no-cache on mutable metadata, immutable bundles, 404 otherwise) with a
 * throw-away self-signed certificate that the "device" client validates. The
 * device is the real OtaUpdateService; only the native plugin is replaced by a
 * stand-in that performs the same checks the plugin does natively (download
 * over TLS, decrypt, verify the RSA-signed checksum) and records every byte it
 * accepts. Nothing here touches the network beyond 127.0.0.1.
 *
 * Skipped (loudly) when no `openssl` binary is available to mint the cert.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request as httpsRequest, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptBundle, generateKeyPair, verifyManifestEnvelope } from './bundle-crypto.mjs';
import { promoteRelease, publishRelease, rollbackRelease } from './release-store.mjs';
import { syncTrees } from './sync.mjs';
import { verifyRemoteChannel } from './verify-remote.mjs';
import { OtaUpdateService } from '../../src/ota/ota-service.js';
import { OtaStateStore, type KeyValueStorage } from '../../src/ota/ota-state-store.js';
import { UpdateGuardRegistry } from '../../src/ota/update-guards.js';
import { FakeUpdater } from '../../src/ota/ota-test-helpers.js';

const FP_A = 'a'.repeat(32);
const FP_B = 'b'.repeat(32);

function findOpenssl(): string | null {
  const candidates = [
    process.env.OPENSSL_BIN,
    'openssl',
    'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}
const OPENSSL = findOpenssl();

const scratch = mkdtempSync(join(tmpdir(), 'erve-ota-https-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const dir = (name: string) => {
  counter += 1;
  const path = join(scratch, `${name}-${counter}`);
  mkdirSync(path, { recursive: true });
  return path;
};
function write(root: string, relative: string, contents: string) {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}

// ---- disposable PKI + keys --------------------------------------------------

const pair = generateKeyPair();
const keys = { publicKeyPem: pair.publicKeyPem, privateKeyPem: pair.privateKeyPem };
let cert = '';
let certKey = '';
if (OPENSSL) {
  const pki = dir('pki');
  execFileSync(
    OPENSSL,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      join(pki, 'key.pem'),
      '-out',
      join(pki, 'cert.pem'),
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  cert = readFileSync(join(pki, 'cert.pem'), 'utf8');
  certKey = readFileSync(join(pki, 'key.pem'), 'utf8');
}

// ---- nginx-like static HTTPS server ----------------------------------------

const PREFIX = '/mobile-updates/bundles/';
interface Served {
  server: Server;
  base: string;
  root: string;
  requests: string[];
  /** Mutates a response body before it is sent (to simulate tampering in transit). */
  tamper: ((path: string, body: Buffer) => Buffer) | null;
  /** Overrides cache headers (to prove the verifier notices a bad config). */
  noImmutable: boolean;
  /** Makes every request fail with 503. */
  down: boolean;
}

async function startServer(root: string): Promise<Served> {
  const state = { requests: [] as string[], tamper: null, noImmutable: false, down: false } as Pick<
    Served,
    'requests' | 'tamper' | 'noImmutable' | 'down'
  >;
  const server = createServer({ key: certKey, cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://localhost').pathname;
    state.requests.push(path);
    if (state.down) {
      res.writeHead(503);
      res.end('maintenance');
      return;
    }
    if (!path.startsWith(PREFIX)) {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    const file = normalize(join(root, path.slice(PREFIX.length)));
    if (!file.startsWith(resolve(root)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    const isBundle = file.endsWith('.bundle');
    let body = readFileSync(file);
    if (state.tamper) body = state.tamper(path, body);
    res.writeHead(200, {
      'Content-Type': isBundle ? 'application/octet-stream' : 'application/json',
      'Content-Length': body.length,
      // Same policy as deployment/nginx/erve.vhost.example.conf
      'Cache-Control': isBundle
        ? state.noImmutable
          ? 'public, max-age=3600'
          : 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const served = {
    server,
    base: `https://localhost:${port}${PREFIX.replace(/\/$/, '')}`,
    root,
    ...state,
  };
  // keep the live references (state fields are mutated by tests)
  return new Proxy(served, {
    get: (target, key) => (key in state ? (state as never)[key] : (target as never)[key]),
    set: (target, key, value) => {
      if (key in state) (state as never)[key] = value;
      else (target as never)[key] = value;
      return true;
    },
  }) as Served;
}

/** HTTPS GET validating the test certificate (the device-equivalent client). */
function httpsGet(
  url: string,
  timeoutMs = 10_000,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  return new Promise((resolveRequest, reject) => {
    const req = httpsRequest(url, { ca: cert, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolveRequest({
          status: res.statusCode ?? 0,
          headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])),
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const fetchWithCa = (async (url: string) => {
  const result = await httpsGet(url);
  return {
    status: result.status,
    headers: new Headers(result.headers),
    arrayBuffer: async () =>
      result.body.buffer.slice(result.body.byteOffset, result.body.byteOffset + result.body.length),
  };
}) as unknown as typeof fetch;

// ---- device stand-in ----------------------------------------------------------

/** Performs the same acceptance checks as the native plugin, on real bytes. */
class NativeLikeUpdater extends FakeUpdater {
  readonly accepted: Array<{ version: string; fileSha: string; zipSha: string }> = [];
  private readonly store = new Map<string, { id: string; version: string }>();

  constructor(
    fingerprint: string,
    channel: string,
    private readonly publicKeyPem: string,
  ) {
    super();
    this.builtinVersion = `0.1.0-erve-native.${fingerprint}.${channel}`;
  }

  override async download(options: {
    url: string;
    version: string;
    checksum: string;
    sessionKey: string;
  }) {
    const response = await httpsGet(options.url);
    if (response.status !== 200) throw new Error(`download failed: HTTP ${response.status}`);
    let zip: Buffer;
    try {
      zip = decryptBundle(response.body, options, this.publicKeyPem);
    } catch (error) {
      throw new Error(`checksum verification failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
    const info = await super.download(options);
    this.accepted.push({
      version: options.version,
      fileSha: createHash('sha256').update(response.body).digest('hex'),
      zipSha: createHash('sha256').update(zip).digest('hex'),
    });
    this.store.set(info.id, { id: info.id, version: options.version });
    return info;
  }

  override async set(bundleId: string) {
    await super.set(bundleId);
    const bundle = this.store.get(bundleId)!;
    this.currentBundle = { id: bundle.id, version: bundle.version, status: 'pending' };
    this.bundles = this.bundles.filter((b) => b.id !== bundleId);
  }

  override async notifyAppReady() {
    await super.notifyAppReady();
    if (this.currentBundle.id !== 'builtin')
      this.currentBundle = { ...this.currentBundle, status: 'success' };
  }
}

function memoryStorage(): KeyValueStorage {
  const data: Record<string, string> = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

function device(served: Served, fingerprint: string, channel: 'testing' | 'production') {
  const updater = new NativeLikeUpdater(fingerprint, channel, pair.publicKeyPem);
  const storage = memoryStorage();
  const guards = new UpdateGuardRegistry();
  const make = () =>
    new OtaUpdateService({
      config: {
        enabled: true,
        disabledReason: '',
        publicKey: pair.publicKeyPem,
        baseUrl: served.base,
        allowInsecureHttp: false,
        nativeFingerprint: fingerprint,
      },
      updater,
      httpGetJson: async (url) => {
        const response = await httpsGet(url);
        let data: unknown = response.body.toString('utf8');
        try {
          data = JSON.parse(data as string);
        } catch {
          /* leave as text */
        }
        return { status: response.status, data };
      },
      store: new OtaStateStore(storage),
      guards,
      isNative: true,
    });
  let service = make();
  return {
    updater,
    guards,
    get service() {
      return service;
    },
    /** App cold start: a fresh service instance over the same persisted state. */
    async coldStart() {
      service = make();
      const result = await service.runStartup();
      if (!result.reloading) await service.markReady();
      return result;
    },
  };
}

// ---- release helpers ------------------------------------------------------------

let clock = 1_800_000_000_000;
const tick = () => (clock += 60_000);

function makeDist(fingerprint: string, marker: string) {
  const dist = dir('dist');
  write(dist, 'index.html', `<html><body>erve ${marker}</body></html>`);
  write(dist, 'assets/app.js', `console.log("${marker}")`);
  write(
    dist,
    'ota-build-info.json',
    JSON.stringify({ schema: 2, nativeFingerprint: fingerprint, sourceCommit: marker }),
  );
  return dist;
}

describe.skipIf(!OPENSSL)('self-hosted release flow over local HTTPS (disposable keys)', () => {
  let workstation: string;
  let serverRoot: string;
  let served: Served;

  beforeAll(async () => {
    workstation = dir('workstation');
    serverRoot = dir('server');
    served = await startServer(serverRoot);
  });
  afterAll(() => new Promise<void>((done) => served.server.close(() => done())));

  const publish = (marker: string, fingerprint = FP_A) =>
    publishRelease({
      distDir: makeDist(fingerprint, marker),
      root: workstation,
      fingerprint,
      appVersion: '0.1.0',
      now: tick(),
      ...keys,
    });
  const promote = (build: number) =>
    promoteRelease({ root: workstation, fingerprint: FP_A, build, now: tick(), ...keys });
  const deploy = (extra: object = {}) =>
    syncTrees({ from: workstation, to: serverRoot, publicKeyPem: pair.publicKeyPem, ...extra });
  const requested = (channel: string) => served.requests.filter((p) => p.includes(`/${channel}/`));

  it('1. publish to testing -> testing device downloads, stages and activates it; production sees nothing', async () => {
    const tested = publish('v1');
    deploy();

    const testing = device(served, FP_A, 'testing');
    await testing.coldStart();
    const check = await testing.service.checkForUpdate('manual');
    expect(check.outcome).toBe('update-staged');
    expect(testing.service.getStatus().staged?.version).toBe(tested.version);

    // Safe point (cold start): the staged build activates and then confirms itself.
    const restart = await testing.coldStart();
    expect(restart.reloading).toBe(true);
    await testing.coldStart();
    expect(testing.service.getStatus().currentVersion).toBe(tested.version);
    expect(testing.updater.currentBundle.status).toBe('success');

    // A production device finds no production release at all.
    const production = device(served, FP_A, 'production');
    await production.coldStart();
    const result = await production.service.checkForUpdate('manual');
    expect(result.outcome).toBe('up-to-date');
    expect(production.updater.accepted).toHaveLength(0);
  });

  it('2. channel isolation: devices only ever request their own channel', async () => {
    served.requests.length = 0;
    const testing = device(served, FP_A, 'testing');
    await testing.coldStart();
    await testing.service.checkForUpdate('manual');
    expect(requested('production')).toHaveLength(0);
    expect(requested('testing').length).toBeGreaterThan(0);

    served.requests.length = 0;
    const production = device(served, FP_A, 'production');
    await production.coldStart();
    await production.service.checkForUpdate('manual');
    expect(requested('testing')).toHaveLength(0);
  });

  it('3. explicit promotion: production gets the exact bytes that testers received', async () => {
    const testing = device(served, FP_A, 'testing');
    await testing.coldStart();
    await testing.service.checkForUpdate('manual');
    const tested = JSON.parse(
      Buffer.from(
        JSON.parse(readFileSync(join(workstation, 'testing', 'manifest.json'), 'utf8')).payload,
        'base64',
      ).toString(),
    ).releases[FP_A];
    const live = promote(tested.buildNumber);
    deploy();

    const production = device(served, FP_A, 'production');
    await production.coldStart();
    expect((await production.service.checkForUpdate('manual')).outcome).toBe('update-staged');
    expect(production.updater.accepted).toHaveLength(1);
    expect(production.updater.accepted[0]!.fileSha).toBe(tested.fileSha256);
    expect(production.updater.accepted[0]!.zipSha).toBe(tested.contentSha256);
    expect(production.updater.accepted[0]!.version).toBe(live.version);
  });

  it('4. rejects a tampered bundle in transit: nothing is staged and nothing activates', async () => {
    const production = device(served, FP_A, 'production');
    await production.coldStart();
    served.tamper = (path, body) => {
      if (!path.endsWith('.bundle')) return body;
      const copy = Buffer.from(body);
      copy[copy.length - 40] ^= 0xff;
      return copy;
    };
    try {
      const result = await production.service.checkForUpdate('manual');
      expect(result.outcome).toBe('download-failed');
    } finally {
      served.tamper = null;
    }
    expect(production.service.getStatus().staged).toBeNull();
    expect(production.updater.accepted).toHaveLength(0);
    expect(production.updater.calls.some((c) => c.startsWith('set:'))).toBe(false);
  });

  it('5. rejects a tampered manifest and a manifest signed by another key', async () => {
    const production = device(served, FP_A, 'production');
    await production.coldStart();
    served.tamper = (path, body) => {
      if (!path.endsWith('manifest.json')) return body;
      const envelope = JSON.parse(body.toString('utf8'));
      envelope.payload = Buffer.from(
        Buffer.from(envelope.payload, 'base64').toString().replace('production', 'productioz'),
      ).toString('base64');
      return Buffer.from(JSON.stringify(envelope));
    };
    try {
      expect((await production.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    } finally {
      served.tamper = null;
    }

    // A manifest that is perfectly valid — for a different key.
    const stranger = generateKeyPair();
    const foreign = dir('foreign');
    const foreignDist = makeDist(FP_A, 'foreign');
    const foreignTree = dir('foreign-tree');
    const t = publishRelease({
      distDir: foreignDist,
      root: foreignTree,
      fingerprint: FP_A,
      appVersion: '0.1.0',
      now: tick(),
      publicKeyPem: stranger.publicKeyPem,
      privateKeyPem: stranger.privateKeyPem,
    });
    promoteRelease({
      root: foreignTree,
      fingerprint: FP_A,
      build: t.buildNumber,
      now: tick(),
      publicKeyPem: stranger.publicKeyPem,
      privateKeyPem: stranger.privateKeyPem,
    });
    const forgedManifest = readFileSync(join(foreignTree, 'production', 'manifest.json'));
    void foreign;
    served.tamper = (path, body) =>
      path.endsWith('production/manifest.json') ? forgedManifest : body;
    try {
      expect((await production.service.checkForUpdate('manual')).outcome).toBe('invalid-manifest');
    } finally {
      served.tamper = null;
    }
    expect(production.updater.accepted).toHaveLength(0);
  });

  it('6. incompatible APK: a device with another native fingerprint never downloads the bundle', async () => {
    served.requests.length = 0;
    const other = device(served, FP_B, 'production');
    await other.coldStart();
    const result = await other.service.checkForUpdate('manual');
    expect(result.outcome).toBe('native-update-required');
    expect(served.requests.filter((p) => p.endsWith('.bundle'))).toHaveLength(0);
    expect(other.service.getStatus().nativeUpdateRequired).toBe(true);
  });

  it('7. native APK upgrades stay independent: a new APK generation gets its own release; the old one keeps updating', async () => {
    publish('apk-b', FP_B);
    const testedB = JSON.parse(
      Buffer.from(
        JSON.parse(readFileSync(join(workstation, 'testing', 'manifest.json'), 'utf8')).payload,
        'base64',
      ).toString(),
    ).releases[FP_B];
    promoteRelease({
      root: workstation,
      fingerprint: FP_B,
      build: testedB.buildNumber,
      now: tick(),
      ...keys,
    });
    deploy();

    const newApk = device(served, FP_B, 'production');
    await newApk.coldStart();
    expect((await newApk.service.checkForUpdate('manual')).outcome).toBe('update-staged');

    const oldApk = device(served, FP_A, 'production');
    await oldApk.coldStart();
    const oldResult = await oldApk.service.checkForUpdate('manual');
    expect(oldResult.outcome).toBe('update-staged');
    expect(oldApk.service.getStatus().newerApkAvailable).toBe(true);
    // Each device only ever received its own generation's bytes.
    expect(newApk.updater.accepted[0]!.fileSha).not.toBe(oldApk.updater.accepted[0]!.fileSha);
  });

  it('8. emergency rollback: a device on the bad build is moved to the good content via a higher build and sequence', async () => {
    const productionNow = () =>
      JSON.parse(
        Buffer.from(
          JSON.parse(readFileSync(join(workstation, 'production', 'manifest.json'), 'utf8'))
            .payload,
          'base64',
        ).toString(),
      );
    const good = productionNow().releases[FP_A];

    const badTested = publish('v-bad');
    const bad = promote(badTested.buildNumber);
    deploy();

    // A device installs and confirms the bad build.
    const victim = device(served, FP_A, 'production');
    await victim.coldStart();
    await victim.service.checkForUpdate('manual');
    await victim.coldStart(); // activates
    await victim.coldStart(); // confirms
    expect(victim.service.getStatus().currentVersion).toBe(bad.version);
    const sequenceBefore = productionNow().sequence;

    // Roll back to the good build, then deploy.
    const rolled = rollbackRelease({
      root: workstation,
      channel: 'production',
      fingerprint: FP_A,
      toBuild: good.buildNumber,
      reason: 'v-bad crashes on login',
      now: tick(),
      ...keys,
    });
    deploy();
    expect(rolled.buildNumber).toBeGreaterThan(bad.buildNumber);
    expect(productionNow().sequence).toBeGreaterThan(sequenceBefore);

    const check = await victim.service.checkForUpdate('manual');
    expect(check.outcome).toBe('update-staged');
    await victim.coldStart(); // activates
    await victim.coldStart(); // confirms
    expect(victim.service.getStatus().currentVersion).toBe(rolled.version);
    expect(victim.service.getStatus().currentBuildNumber).toBeGreaterThan(bad.buildNumber);
    const last = victim.updater.accepted.at(-1)!;
    expect(last.zipSha).toBe(good.contentSha256); // the OLD content is running again
    expect(last.fileSha).toBe(good.fileSha256);

    // A device that never saw the bad build also converges on the rolled-back content.
    const fresh = device(served, FP_A, 'production');
    await fresh.coldStart();
    await fresh.service.checkForUpdate('manual');
    expect(fresh.updater.accepted.at(-1)!.zipSha).toBe(good.contentSha256);
  });

  it('9. a failed deployment never becomes active: the live manifest is untouched and still verifies', async () => {
    const before = readFileSync(join(serverRoot, 'production', 'manifest.json'), 'utf8');
    const next = publish('v-next');
    const promoted = promote(next.buildNumber);
    expect(() =>
      deploy({
        hooks: {
          afterBundles: () => {
            throw new Error('connection dropped mid-upload');
          },
        },
      }),
    ).toThrow(/connection dropped/);
    expect(readFileSync(join(serverRoot, 'production', 'manifest.json'), 'utf8')).toBe(before);

    const production = device(served, FP_A, 'production');
    await production.coldStart();
    await production.service.checkForUpdate('manual');
    expect(production.updater.accepted.every((a) => a.version !== promoted.version)).toBe(true);

    // The retry succeeds and then the new release becomes visible.
    deploy();
    const retry = device(served, FP_A, 'production');
    await retry.coldStart();
    await retry.service.checkForUpdate('manual');
    expect(retry.updater.accepted.at(-1)!.version).toBe(promoted.version);
  });

  it('10. the live server passes post-deploy verification, and caching rules are checked', async () => {
    const good = await verifyRemoteChannel({
      baseUrl: served.base,
      channel: 'production',
      publicKeyPem: pair.publicKeyPem,
      fetchImpl: fetchWithCa,
    });
    expect(good.problems).toEqual([]);
    expect(good.ok).toBe(true);
    const testing = await verifyRemoteChannel({
      baseUrl: served.base,
      channel: 'testing',
      publicKeyPem: pair.publicKeyPem,
      fetchImpl: fetchWithCa,
    });
    expect(testing.ok).toBe(true);
    expect(
      verifyManifestEnvelope(
        JSON.parse(readFileSync(join(serverRoot, 'production', 'manifest.json'), 'utf8')),
        pair.publicKeyPem,
      ).channel,
    ).toBe('production');

    served.noImmutable = true;
    try {
      const bad = await verifyRemoteChannel({
        baseUrl: served.base,
        channel: 'production',
        publicKeyPem: pair.publicKeyPem,
        fetchImpl: fetchWithCa,
      });
      expect(bad.ok).toBe(false);
      expect(bad.problems.join('\n')).toMatch(/immutable/);
    } finally {
      served.noImmutable = false;
    }

    served.tamper = (path, body) =>
      path.endsWith('.bundle')
        ? Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([0])])
        : body;
    try {
      const tampered = await verifyRemoteChannel({
        baseUrl: served.base,
        channel: 'production',
        publicKeyPem: pair.publicKeyPem,
        fetchImpl: fetchWithCa,
      });
      expect(tampered.ok).toBe(false);
    } finally {
      served.tamper = null;
    }
  });

  it('11. server down / maintenance leaves the device on its current bundle with a clear status', async () => {
    const production = device(served, FP_A, 'production');
    await production.coldStart();
    served.down = true;
    try {
      const result = await production.service.checkForUpdate('manual');
      expect(result.outcome).toBe('server-unavailable');
    } finally {
      served.down = false;
    }
    expect(production.service.getStatus().currentVersion).toBe('embedded');
  });

  it('12. a device validates the server certificate (an untrusted certificate is refused)', async () => {
    await expect(
      new Promise((resolveRequest, reject) => {
        const req = httpsRequest(
          `${served.base}/production/manifest.json`,
          { timeout: 5000 },
          resolveRequest,
        );
        req.on('error', reject);
        req.end();
      }),
    ).rejects.toThrow(/self[- ]signed|certificate|unable to verify/i);
  });
});

if (!OPENSSL) {
  describe('local HTTPS release flow', () => {
    it.skip('skipped: no openssl binary available to mint the disposable certificate', () =>
      undefined);
  });
}
