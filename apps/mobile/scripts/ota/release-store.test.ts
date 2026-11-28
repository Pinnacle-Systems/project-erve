/**
 * Release lifecycle tests: publish (testing only) -> promote -> rollback, the
 * signed history, retention, immutability, atomic publication, tree sync and
 * the guarantees the app relies on. Uses disposable keys and temp directories.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateKeyPair, sha256Hex, verifyManifestEnvelope } from './bundle-crypto.mjs';
import {
  describeChannel,
  distContainsPrivateKey,
  promoteRelease,
  publishRelease,
  retireGeneration,
  rollbackRelease,
  verifyReleaseTree,
  zipDist,
} from './release-store.mjs';
import {
  assertBundlesDirectory,
  buildManifestProbeCommand,
  buildPullCommand,
  buildPushCommands,
  isRemoteSpec,
  syncTrees,
} from './sync.mjs';
import { copyFileSync } from 'node:fs';
import { verifyAndParseManifest } from '../../src/ota/manifest.js';

const scratch = mkdtempSync(join(tmpdir(), 'erve-ota-release-'));
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

const FP_A = 'a'.repeat(32);
const FP_B = 'b'.repeat(32);
const T0 = 1_800_000_000_000;
const pair = generateKeyPair();
const keys = { publicKeyPem: pair.publicKeyPem, privateKeyPem: pair.privateKeyPem };

/** A built dist/ whose contents (and therefore bytes) are identified by `marker`. */
function makeDist(
  fingerprint: string,
  marker = 'one',
  extra: Record<string, string> = {},
  sourceCommit: string | null = 'c0ffee',
) {
  const distDir = dir('dist');
  write(distDir, 'index.html', `<html><body>erve ${marker}</body></html>`);
  write(distDir, 'assets/app.js', `console.log("${marker}")`);
  write(
    distDir,
    'ota-build-info.json',
    JSON.stringify({ schema: 2, nativeFingerprint: fingerprint, sourceCommit }),
  );
  for (const [name, content] of Object.entries(extra)) write(distDir, name, content);
  return distDir;
}

let clock = T0;
const tick = () => (clock += 60_000);

function publish(root: string, marker: string, extra: object = {}, fingerprint = FP_A) {
  return publishRelease({
    distDir: makeDist(fingerprint, marker),
    root,
    fingerprint,
    appVersion: '1.2.3',
    now: tick(),
    ...keys,
    ...extra,
  });
}
const promote = (root: string, build: number, extra: object = {}) =>
  promoteRelease({ root, fingerprint: FP_A, build, now: tick(), ...keys, ...extra });
const rollback = (root: string, channel: string, toBuild: number, extra: object = {}) =>
  rollbackRelease({
    root,
    channel,
    fingerprint: FP_A,
    toBuild,
    reason: 'bad release',
    now: tick(),
    ...keys,
    ...extra,
  });
const manifestOf = (root: string, channel: string) =>
  verifyManifestEnvelope(
    JSON.parse(readFileSync(join(root, channel, 'manifest.json'), 'utf8')),
    pair.publicKeyPem,
  );
const verify = (root: string) => verifyReleaseTree(root, pair.publicKeyPem);

describe('publish to the selected channel', () => {
  it('publishes to testing and nothing else', () => {
    const root = dir('tree');
    const result = publish(root, 'one');
    expect(result.channel).toBe('testing');
    expect(result.version).toBe(`1.2.3-ota.${result.buildNumber}`);
    expect(existsSync(join(root, 'testing', 'manifest.json'))).toBe(true);
    expect(existsSync(join(root, 'production'))).toBe(false);
    expect(manifestOf(root, 'testing').releases[FP_A].sourceCommit).toBe('c0ffee');
    expect(verify(root).testing.releases[FP_A].files).toBe(3);
  });

  it('publishes directly to production and can roll back a bad update', () => {
    const root = dir('tree');
    const good = publish(root, 'good', { channel: 'production' });
    const bad = publish(root, 'bad', { channel: 'production' });
    expect(good.channel).toBe('production');
    expect(bad.buildNumber).toBeGreaterThan(good.buildNumber);
    expect(existsSync(join(root, 'testing'))).toBe(false);
    expect(verify(root).production.releases[FP_A].files).toBe(3);
    const restored = rollback(root, 'production', good.buildNumber);
    expect(restored.buildNumber).toBeGreaterThan(bad.buildNumber);
    expect(verify(root).production.releases[FP_A]).toBeDefined();
  });

  it('refuses unknown channels', () => {
    expect(() => publish(dir('tree'), 'one', { channel: 'staging' })).toThrow(
      /only be published|Unknown channel/,
    );
  });

  it('refuses a dist built for another native layer, without build info, or without index.html', () => {
    const root = dir('tree');
    expect(() => publish(root, 'one', { distDir: makeDist(FP_B) })).toThrow(/native fingerprint/);
    const noInfo = dir('dist');
    write(noInfo, 'index.html', 'x');
    expect(() => publish(root, 'one', { distDir: noInfo })).toThrow(/ota-build-info/);
    const noIndex = dir('dist');
    write(noIndex, 'ota-build-info.json', JSON.stringify({ nativeFingerprint: FP_A }));
    expect(() => publish(root, 'one', { distDir: noIndex })).toThrow(/index\.html/);
  });

  it('refuses hidden files and any private key material in the bundle', () => {
    const root = dir('tree');
    expect(() => publish(root, 'one', { distDir: makeDist(FP_A, 'x', { '.env': 'S=1' }) })).toThrow(
      /hidden/,
    );
    const leaked = makeDist(FP_A, 'x', { 'assets/oops.txt': pair.privateKeyPem });
    expect(distContainsPrivateKey(leaked)).toBe(true);
    expect(() => publish(root, 'one', { distDir: leaked })).toThrow(/private key/);
    expect(existsSync(join(root, 'testing'))).toBe(false);
    // A bare string naming the format (as in some libraries) is not a key.
    const benign = makeDist(FP_A, 'x', {
      'assets/lib.js': 'const h="-----BEGIN PRIVATE KEY-----";',
    });
    expect(distContainsPrivateKey(benign)).toBe(false);
  });

  it('refuses to sign with a key that is not the one compiled into the app', () => {
    const wrong = generateKeyPair();
    expect(() => publish(dir('tree'), 'one', { privateKeyPem: wrong.privateKeyPem })).toThrow(
      /does not match/,
    );
  });

  it('never overwrites a signed file it cannot verify (wrong key / tampered tree)', () => {
    const root = dir('tree');
    publish(root, 'one');
    const other = generateKeyPair();
    expect(() =>
      publish(root, 'two', {
        publicKeyPem: other.publicKeyPem,
        privateKeyPem: other.privateKeyPem,
      }),
    ).toThrow(/signature/i);
  });

  it('assigns strictly increasing build numbers and manifest sequences', () => {
    const root = dir('tree');
    const a = publish(root, 'one');
    const b = publish(root, 'two');
    expect(b.buildNumber).toBeGreaterThan(a.buildNumber);
    expect(b.sequence).toBeGreaterThan(a.sequence);
    expect(() => publish(root, 'three', { buildNumber: b.buildNumber })).toThrow(/greater/);
  });

  it('the manifest it produces passes the strict app-side parser', async () => {
    const root = dir('tree');
    publish(root, 'one');
    const envelope = JSON.parse(readFileSync(join(root, 'testing', 'manifest.json'), 'utf8'));
    const manifest = await verifyAndParseManifest(envelope, pair.publicKeyPem, 'testing');
    expect(manifest.releases[FP_A].url).toMatch(new RegExp(`^${FP_A}/\\d+\\.bundle$`));
  });

  it('zips deterministically with index.html at the root', () => {
    const distDir = makeDist(FP_A);
    expect(zipDist(distDir).equals(zipDist(distDir))).toBe(true);
    const bad = dir('dist');
    write(bad, 'sub/index.html', 'x');
    expect(() => zipDist(bad)).toThrow(/index\.html/);
  });
});

describe('promotion: testing -> production', () => {
  it('copies the exact tested bytes under a new production build number', () => {
    const root = dir('tree');
    const tested = publish(root, 'one');
    const live = promote(root, tested.buildNumber);
    expect(live.channel).toBe('production');
    expect(live.buildNumber).toBeGreaterThan(0);
    // Byte-identical file, identical signature material, nothing rebuilt.
    const testingFile = readFileSync(join(root, 'testing', FP_A, `${tested.buildNumber}.bundle`));
    const productionFile = readFileSync(
      join(root, 'production', FP_A, `${live.buildNumber}.bundle`),
    );
    expect(productionFile.equals(testingFile)).toBe(true);
    const t = manifestOf(root, 'testing').releases[FP_A];
    const p = manifestOf(root, 'production').releases[FP_A];
    expect(p.checksum).toBe(t.checksum);
    expect(p.sessionKey).toBe(t.sessionKey);
    expect(p.contentSha256).toBe(t.contentSha256);
    expect(p.fileSha256).toBe(t.fileSha256);
    expect(manifestOf(root, 'production').channel).toBe('production');
    expect(verify(root).production.releases[FP_A]).toBeDefined();
  });

  it('is explicit: the exact testing build must be named, and only the build testers received', () => {
    const root = dir('tree');
    const first = publish(root, 'one');
    const second = publish(root, 'two');
    expect(() => promote(root, first.buildNumber)).toThrow(/not the build currently published/);
    expect(() => promote(root, 999)).toThrow(/not the build currently published/);
    expect(existsSync(join(root, 'production'))).toBe(false);
    expect(promote(root, second.buildNumber).channel).toBe('production');
  });

  it('refuses when testing has nothing for that native layer, and when production already has this bundle', () => {
    const root = dir('tree');
    expect(() => promote(root, 1)).toThrow(/no release/);
    const tested = publish(root, 'one');
    promote(root, tested.buildNumber);
    expect(() => promote(root, tested.buildNumber)).toThrow(/already serves exactly this bundle/);
  });

  it('refuses a build made from uncommitted changes unless explicitly allowed', () => {
    const root = dir('tree');
    const tested = publishRelease({
      distDir: makeDist(FP_A, 'dirty', {}, 'abc123+dirty'),
      root,
      fingerprint: FP_A,
      appVersion: '1.2.3',
      now: tick(),
      ...keys,
    });
    expect(() => promote(root, tested.buildNumber)).toThrow(/uncommitted/);
    expect(promote(root, tested.buildNumber, { allowDirty: true }).channel).toBe('production');
  });

  it('records the promotion in the signed production history and leaves testing untouched', () => {
    const root = dir('tree');
    const tested = publish(root, 'one');
    const before = readFileSync(join(root, 'testing', 'manifest.json'), 'utf8');
    promote(root, tested.buildNumber);
    expect(readFileSync(join(root, 'testing', 'manifest.json'), 'utf8')).toBe(before);
    const history = describeChannel(root, 'production', pair.publicKeyPem).entries;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: 'promote',
      from: { channel: 'testing', buildNumber: tested.buildNumber },
      isLive: true,
    });
  });

  it('refuses to promote a testing bundle that was modified after it was published', () => {
    const root = dir('tree');
    const tested = publish(root, 'one');
    const file = join(root, 'testing', FP_A, `${tested.buildNumber}.bundle`);
    const bytes = readFileSync(file);
    bytes[bytes.length - 30] ^= 0xff;
    writeFileSync(file, bytes);
    expect(() => promote(root, tested.buildNumber)).toThrow();
    expect(existsSync(join(root, 'production'))).toBe(false);
  });
});

describe('channel isolation', () => {
  it('keeps testing and production manifests, histories and files separate', () => {
    const root = dir('tree');
    const t1 = publish(root, 'one');
    promote(root, t1.buildNumber);
    const prodBefore = readFileSync(join(root, 'production', 'manifest.json'), 'utf8');
    const t2 = publish(root, 'two'); // testing moves on
    expect(readFileSync(join(root, 'production', 'manifest.json'), 'utf8')).toBe(prodBefore);
    expect(manifestOf(root, 'testing').releases[FP_A].buildNumber).toBe(t2.buildNumber);
    expect(manifestOf(root, 'production').channel).toBe('production');
    expect(manifestOf(root, 'testing').channel).toBe('testing');
    const prodFiles = readdirSync(join(root, 'production', FP_A));
    const testFiles = readdirSync(join(root, 'testing', FP_A));
    expect(prodFiles).toHaveLength(1);
    expect(testFiles).toHaveLength(2);
  });

  it('verification rejects a manifest copied into the wrong channel directory', () => {
    const root = dir('tree');
    publish(root, 'one');
    mkdirSync(join(root, 'production'), { recursive: true });
    writeFileSync(
      join(root, 'production', 'manifest.json'),
      readFileSync(join(root, 'testing', 'manifest.json')),
    );
    writeFileSync(
      join(root, 'production', 'history.json'),
      readFileSync(join(root, 'testing', 'history.json')),
    );
    expect(() => verify(root)).toThrow(/isolation|channel/);
  });

  it('rollback in one channel cannot reach into the other', () => {
    const root = dir('tree');
    const t1 = publish(root, 'one');
    publish(root, 'two');
    promote(root, manifestOf(root, 'testing').releases[FP_A].buildNumber);
    // production never saw testing build t1
    expect(() => rollback(root, 'production', t1.buildNumber)).toThrow(/no recorded build/);
  });
});

describe('emergency rollback', () => {
  /** testing -> production twice: good then bad. */
  function twoProductionReleases() {
    const root = dir('tree');
    const goodTest = publish(root, 'good');
    const good = promote(root, goodTest.buildNumber);
    const badTest = publish(root, 'bad');
    const bad = promote(root, badTest.buildNumber);
    return { root, good, bad };
  }

  it('re-releases the earlier bytes under a HIGHER build number and a HIGHER manifest sequence', () => {
    const { root, good, bad } = twoProductionReleases();
    const rolled = rollback(root, 'production', good.buildNumber);
    expect(rolled.buildNumber).toBeGreaterThan(bad.buildNumber);
    expect(rolled.sequence).toBeGreaterThan(bad.sequence);
    const live = manifestOf(root, 'production').releases[FP_A];
    expect(live.buildNumber).toBe(rolled.buildNumber);
    expect(live.contentSha256).toBe(good.contentSha256);
    expect(live.fileSha256).toBe(good.fileSha256);
    expect(
      readFileSync(join(root, 'production', FP_A, `${rolled.buildNumber}.bundle`)).equals(
        readFileSync(join(root, 'production', FP_A, `${good.buildNumber}.bundle`)),
      ),
    ).toBe(true);
    expect(verify(root).production.releases[FP_A]).toBeDefined();
  });

  it('is recorded with its reason and what it restores, and keeps the audit trail intact', () => {
    const { root, good, bad } = twoProductionReleases();
    const rolled = rollback(root, 'production', good.buildNumber, { reason: 'crash on login' });
    const { entries } = describeChannel(root, 'production', pair.publicKeyPem);
    expect(entries.map((e: { action: string }) => e.action)).toEqual([
      'promote',
      'promote',
      'rollback',
    ]);
    expect(entries[2]).toMatchObject({
      reason: 'crash on login',
      restores: { buildNumber: good.buildNumber },
      buildNumber: rolled.buildNumber,
      isLive: true,
    });
    expect(entries[1]).toMatchObject({
      buildNumber: bad.buildNumber,
      isLive: false,
      restorable: true,
    });
  });

  it('requires a reason and an existing, restorable, non-live target', () => {
    const { root, good, bad } = twoProductionReleases();
    expect(() => rollback(root, 'production', good.buildNumber, { reason: '  ' })).toThrow(
      /reason/,
    );
    expect(() => rollback(root, 'production', 424242)).toThrow(/no recorded build/);
    expect(() => rollback(root, 'production', bad.buildNumber)).toThrow(/already the live release/);
    const rolled = rollback(root, 'production', good.buildNumber);
    // Rolling "back" to the bad build again is still allowed as a new forward release.
    expect(rollback(root, 'production', bad.buildNumber).buildNumber).toBeGreaterThan(
      rolled.buildNumber,
    );
  });

  it('refuses a target whose file was modified or pruned', () => {
    const { root, good } = twoProductionReleases();
    const file = join(root, 'production', FP_A, `${good.buildNumber}.bundle`);
    const original = readFileSync(file);
    const tampered = Buffer.from(original);
    tampered[tampered.length - 25] ^= 0xff;
    writeFileSync(file, tampered);
    expect(() => rollback(root, 'production', good.buildNumber)).toThrow(
      /hash|checksum|decrypt|bad/i,
    );
    rmSync(file);
    expect(() => rollback(root, 'production', good.buildNumber)).toThrow(/pruned/);
  });

  it('works on the testing channel too, and a manifest never goes backwards in sequence', () => {
    const root = dir('tree');
    const one = publish(root, 'one');
    const two = publish(root, 'two');
    const rolled = rollback(root, 'testing', one.buildNumber);
    expect(rolled.sequence).toBeGreaterThan(two.sequence);
    expect(manifestOf(root, 'testing').releases[FP_A].contentSha256).toBe(one.contentSha256);
  });

  it('the app-side parser accepts the rollback manifest', async () => {
    const { root, good } = twoProductionReleases();
    rollback(root, 'production', good.buildNumber);
    const manifest = await verifyAndParseManifest(
      JSON.parse(readFileSync(join(root, 'production', 'manifest.json'), 'utf8')),
      pair.publicKeyPem,
      'production',
    );
    expect(manifest.releases[FP_A].version).toMatch(/-ota\.\d+$/);
  });
});

describe('failed releases never become active', () => {
  it('a failure after the bundle is written but before the manifest leaves the channel untouched and removes the orphan', () => {
    const root = dir('tree');
    const first = publish(root, 'one');
    const manifestBefore = readFileSync(join(root, 'testing', 'manifest.json'), 'utf8');
    const filesBefore = readdirSync(join(root, 'testing', FP_A));
    expect(() =>
      publish(root, 'two', {
        hooks: {
          beforeManifest: () => {
            throw new Error('simulated crash');
          },
        },
      }),
    ).toThrow(/simulated crash/);
    expect(readFileSync(join(root, 'testing', 'manifest.json'), 'utf8')).toBe(manifestBefore);
    expect(readdirSync(join(root, 'testing', FP_A))).toEqual(filesBefore);
    expect(manifestOf(root, 'testing').releases[FP_A].buildNumber).toBe(first.buildNumber);
    expect(() => verify(root)).not.toThrow();
    // …and the next attempt succeeds cleanly.
    expect(publish(root, 'two').buildNumber).toBeGreaterThan(first.buildNumber);
  });

  it('a promotion that fails verification never reaches production', () => {
    const root = dir('tree');
    const tested = publish(root, 'one');
    expect(() =>
      promote(root, tested.buildNumber, {
        hooks: {
          beforeManifest: () => {
            throw new Error('boom');
          },
        },
      }),
    ).toThrow(/boom/);
    expect(existsSync(join(root, 'production', 'manifest.json'))).toBe(false);
    expect(
      existsSync(join(root, 'production', FP_A)) ? readdirSync(join(root, 'production', FP_A)) : [],
    ).toEqual([]);
  });

  it('a crash between the manifest and the history write is repaired on the next operation', () => {
    const root = dir('tree');
    const one = publish(root, 'one');
    rmSync(join(root, 'testing', 'history.json')); // simulate: manifest written, history never was
    const two = publish(root, 'two');
    const { entries } = describeChannel(root, 'testing', pair.publicKeyPem);
    expect(
      entries.map((e: { action: string; buildNumber: number }) => [e.action, e.buildNumber]),
    ).toEqual([
      ['recovered', one.buildNumber],
      ['publish', two.buildNumber],
    ]);
    expect(() => verify(root)).not.toThrow();
  });

  it('bundle files are immutable: an existing build file is never overwritten', () => {
    const root = dir('tree');
    const one = publish(root, 'one');
    expect(() => publish(root, 'other', { buildNumber: one.buildNumber })).toThrow(/greater/);
    // Even with the manifest and history gone, an existing file name is refused.
    rmSync(join(root, 'testing', 'manifest.json'));
    rmSync(join(root, 'testing', 'history.json'));
    expect(() => publish(root, 'other', { buildNumber: one.buildNumber })).toThrow(/immutable/);
    expect(sha256Hex(readFileSync(join(root, 'testing', FP_A, `${one.buildNumber}.bundle`)))).toBe(
      one.fileSha256,
    );
  });

  it('only one release operation runs at a time per tree', () => {
    const root = dir('tree');
    mkdirSync(join(root, '.release.lock'));
    expect(() => publish(root, 'one')).toThrow(/Another release operation/);
  });
});

describe('verification', () => {
  it('catches a corrupted bundle, a tampered manifest or history, and leftover partial files', () => {
    const root = dir('tree');
    const one = publish(root, 'one');
    const file = join(root, 'testing', FP_A, `${one.buildNumber}.bundle`);
    const good = readFileSync(file);
    const corrupt = Buffer.from(good);
    corrupt[corrupt.length - 40] ^= 0xff;
    writeFileSync(file, corrupt);
    expect(() => verify(root)).toThrow();
    writeFileSync(file, good);
    expect(() => verify(root)).not.toThrow();

    writeFileSync(join(root, 'testing', FP_A, '5.bundle.tmp-123'), 'partial');
    expect(() => verify(root)).toThrow(/partial/);
    rmSync(join(root, 'testing', FP_A, '5.bundle.tmp-123'));

    for (const name of ['manifest.json', 'history.json']) {
      const path = join(root, 'testing', name);
      const original = readFileSync(path, 'utf8');
      const envelope = JSON.parse(original);
      envelope.payload = Buffer.from(
        Buffer.from(envelope.payload, 'base64').toString().replace('testing', 'prodxxx'),
      ).toString('base64');
      writeFileSync(path, JSON.stringify(envelope));
      expect(() => verify(root)).toThrow(/signature/i);
      writeFileSync(path, original);
    }
  });

  it('detects a stale (rolled-back) manifest next to a newer history', () => {
    const root = dir('tree');
    publish(root, 'one');
    const staleManifest = readFileSync(join(root, 'testing', 'manifest.json'), 'utf8');
    publish(root, 'two');
    writeFileSync(join(root, 'testing', 'manifest.json'), staleManifest);
    expect(() => verify(root)).toThrow(/stale|newer/);
  });
});

describe('retention and generations', () => {
  it('keeps the newest N bundle files per fingerprint plus the live one, but never prunes history', () => {
    const root = dir('tree');
    const builds: number[] = [];
    for (let i = 0; i < 6; i += 1)
      builds.push(publish(root, `v${i}`, { retention: 3 }).buildNumber);
    const files = readdirSync(join(root, 'testing', FP_A)).sort();
    expect(files).toEqual(
      builds
        .slice(-3)
        .map((b) => `${b}.bundle`)
        .sort(),
    );
    const { entries } = describeChannel(root, 'testing', pair.publicKeyPem);
    expect(entries).toHaveLength(6);
    expect(entries.filter((e: { restorable: boolean }) => e.restorable)).toHaveLength(3);
    expect(() => rollback(root, 'testing', builds[0]!)).toThrow(/pruned/);
    expect(rollback(root, 'testing', builds[3]!).buildNumber).toBeGreaterThan(builds[5]!);
  });

  it('retention in one channel never deletes the other channel’s files', () => {
    const root = dir('tree');
    const first = publish(root, 'v0');
    promote(root, first.buildNumber);
    for (let i = 1; i < 5; i += 1) publish(root, `v${i}`, { retention: 2 });
    expect(readdirSync(join(root, 'production', FP_A))).toHaveLength(1);
    expect(() => verify(root)).not.toThrow();
  });

  it('tracks APK generations: a new fingerprint becomes latest, hotfixing an old one does not, retire withdraws', () => {
    const root = dir('tree');
    publish(root, 'a1');
    publish(root, 'b1', {}, FP_B);
    expect(manifestOf(root, 'testing').latestNativeFingerprint).toBe(FP_B);
    publish(root, 'a2');
    expect(manifestOf(root, 'testing').latestNativeFingerprint).toBe(FP_B);
    retireGeneration({
      root,
      channel: 'testing',
      fingerprints: [FP_A],
      reason: 'APK A end of life',
      now: tick(),
      ...keys,
    });
    expect(Object.keys(manifestOf(root, 'testing').releases)).toEqual([FP_B]);
    expect(() => verify(root)).not.toThrow();
    // A retired generation can be brought back by a rollback (a new forward release).
    const entries = describeChannel(root, 'testing', pair.publicKeyPem).entries;
    const a1 = entries.find(
      (e: { fingerprint: string; action: string }) =>
        e.fingerprint === FP_A && e.action === 'publish',
    )!;
    expect(a1.restorable).toBe(true);
    rollback(root, 'testing', a1.buildNumber);
    expect(Object.keys(manifestOf(root, 'testing').releases).sort()).toEqual([FP_A, FP_B]);
    expect(manifestOf(root, 'testing').latestNativeFingerprint).toBe(FP_B);
  });

  it('build numbers stay monotonic even after a generation was retired and re-released', () => {
    const root = dir('tree');
    const a1 = publish(root, 'a1');
    retireGeneration({
      root,
      channel: 'testing',
      fingerprints: [FP_A],
      reason: 'x',
      now: tick(),
      ...keys,
    });
    const a2 = publish(root, 'a2', { buildNumber: a1.buildNumber + 1 });
    expect(a2.buildNumber).toBe(a1.buildNumber + 1);
    expect(() => publish(root, 'a3', { buildNumber: a1.buildNumber })).toThrow(/greater/);
  });
});

describe('tree sync (bundles -> history -> manifest, verified before activation)', () => {
  function releasedTree() {
    const root = dir('workstation');
    const t = publish(root, 'one');
    promote(root, t.buildNumber);
    return { root, t };
  }

  it('publishes a verified tree to an empty server directory', () => {
    const { root } = releasedTree();
    const server = dir('server');
    const result = syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    expect(result.copied).toHaveLength(2);
    expect(verify(server).production.releases[FP_A]).toBeDefined();
    expect(existsSync(join(server, '.release.lock'))).toBe(false);
  });

  it('does not expose a half-copied release: a failure before the manifest swap keeps the old release live', () => {
    const { root } = releasedTree();
    const server = dir('server');
    syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    const liveBefore = readFileSync(join(server, 'production', 'manifest.json'), 'utf8');

    const next = publish(root, 'two');
    promote(root, next.buildNumber);
    expect(() =>
      syncTrees({
        from: root,
        to: server,
        publicKeyPem: pair.publicKeyPem,
        hooks: {
          afterBundles: () => {
            throw new Error('connection dropped');
          },
        },
      }),
    ).toThrow(/connection dropped/);
    expect(readFileSync(join(server, 'production', 'manifest.json'), 'utf8')).toBe(liveBefore);
    expect(() => verify(server)).not.toThrow();
  });

  it('refuses to activate when a copied bundle does not verify at the destination (truncated upload)', () => {
    const { root } = releasedTree();
    const server = dir('server');
    syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    const liveBefore = readFileSync(join(server, 'production', 'manifest.json'), 'utf8');

    const next = publish(root, 'two');
    const promoted = promote(root, next.buildNumber);
    expect(() =>
      syncTrees({
        from: root,
        to: server,
        publicKeyPem: pair.publicKeyPem,
        prune: false,
        hooks: {
          afterBundles: () => {
            const copied = join(server, 'production', FP_A, `${promoted.buildNumber}.bundle`);
            writeFileSync(copied, readFileSync(copied).subarray(0, 100));
          },
        },
      }),
    ).toThrow(/size|checksum|decrypt/i);
    expect(readFileSync(join(server, 'production', 'manifest.json'), 'utf8')).toBe(liveBefore);
    expect(manifestOf(server, 'production').releases[FP_A].buildNumber).not.toBe(
      promoted.buildNumber,
    );
  });

  it('never rewrites an existing immutable bundle with different content', () => {
    const { root } = releasedTree();
    const server = dir('server');
    syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    const live = manifestOf(server, 'production').releases[FP_A];
    const file = join(server, 'production', FP_A, `${live.buildNumber}.bundle`);
    writeFileSync(file, 'evil');
    expect(() => syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem })).toThrow(
      /immutable/,
    );
  });

  it('refuses to push a STALE tree over a newer server (devices would ignore the lower sequence)', () => {
    const { root } = releasedTree();
    const server = dir('server');
    syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    const stale = dir('stale');
    syncTrees({ from: server, to: stale, publicKeyPem: pair.publicKeyPem }); // a copy taken now
    // The workstation moves on and deploys a newer production release…
    const next = publish(root, 'two');
    promote(root, next.buildNumber);
    syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    const liveBefore = readFileSync(join(server, 'production', 'manifest.json'), 'utf8');
    // …then someone pushes the stale copy: refused, server untouched.
    expect(() => syncTrees({ from: stale, to: server, publicKeyPem: pair.publicKeyPem })).toThrow(
      /newer|stale/,
    );
    expect(readFileSync(join(server, 'production', 'manifest.json'), 'utf8')).toBe(liveBefore);
  });

  it('applies the same stale-tree check before any remote push (probing only the remote manifests)', () => {
    const { root } = releasedTree();
    const remoteMirror = dir('remote-mirror'); // what the server holds, newer than the tree
    syncTrees({ from: root, to: remoteMirror, publicKeyPem: pair.publicKeyPem });
    const stale = dir('stale');
    syncTrees({ from: root, to: stale, publicKeyPem: pair.publicKeyPem });
    const next = publish(root, 'two');
    promote(root, next.buildNumber);
    syncTrees({ from: root, to: remoteMirror, publicKeyPem: pair.publicKeyPem });

    const calls: string[] = [];
    // Fake rsync: the probe "downloads" the server's manifests; anything else is recorded.
    const run = (_cmd: string, args: string[]) => {
      // The probe is the only rsync that is not a push (no --exclude=.release.lock).
      const label = !args.includes('--exclude=.release.lock') ? 'probe' : 'push';
      calls.push(label);
      if (label === 'probe') {
        const dest = args.at(-1)!;
        for (const channel of ['testing', 'production']) {
          mkdirSync(join(dest, channel), { recursive: true });
          copyFileSync(
            join(remoteMirror, channel, 'manifest.json'),
            join(dest, channel, 'manifest.json'),
          );
        }
      }
      return { status: 0 } as never;
    };
    expect(() =>
      syncTrees({
        from: stale,
        to: 'u@h:/srv/bundles',
        publicKeyPem: pair.publicKeyPem,
        run,
        log: () => undefined,
      } as never),
    ).toThrow(/newer|stale/);
    expect(calls).toEqual(['probe']); // nothing was pushed
  });

  it('refuses to push a tree that does not verify', () => {
    const { root } = releasedTree();
    const live = manifestOf(root, 'production').releases[FP_A];
    const file = join(root, 'production', FP_A, `${live.buildNumber}.bundle`);
    const bytes = readFileSync(file);
    bytes[bytes.length - 30] ^= 0xff;
    writeFileSync(file, bytes);
    const server = dir('server');
    expect(() => syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem })).toThrow();
    expect(existsSync(join(server, 'production', 'manifest.json'))).toBe(false);
  });

  it('prunes server bundle files the workstation no longer keeps, only after activation', () => {
    const root = dir('workstation');
    const server = dir('server');
    for (let i = 0; i < 4; i += 1) {
      publish(root, `v${i}`, { retention: 2 });
      syncTrees({ from: root, to: server, publicKeyPem: pair.publicKeyPem });
    }
    expect(readdirSync(join(server, 'testing', FP_A))).toHaveLength(2);
    const kept = readdirSync(join(root, 'testing', FP_A)).sort();
    expect(readdirSync(join(server, 'testing', FP_A)).sort()).toEqual(kept);
  });

  it('builds ordered, shell-free rsync commands: bundles first (never overwriting), manifest last', () => {
    const commands = buildPushCommands({
      from: '/tree',
      to: 'deploy@host:/srv/shared/mobile-updates/bundles',
      sshCommand: 'ssh -p 2222',
    });
    expect(commands.map((c) => c.label)).toEqual(['bundles', 'history', 'manifest', 'prune']);
    expect(commands[0]!.args).toContain('--ignore-existing');
    expect(commands[0]!.args).toContain('--include=/testing/*/*.bundle');
    expect(commands[0]!.args).toContain('--include=/production/*/*.bundle');
    expect(commands[1]!.args).toContain('--include=/testing/history.json');
    expect(commands[2]!.args).toContain('--include=/production/manifest.json');
    expect(commands[2]!.args).not.toContain('--delete');
    expect(commands[3]!.args).toContain('--delete');
    for (const c of commands) {
      expect(c.args).toContain('--exclude=.release.lock');
      expect(c.args.at(-1)).toBe('deploy@host:/srv/shared/mobile-updates/bundles/');
      expect(c.args).toContain('ssh -p 2222');
    }
    expect(buildPushCommands({ from: '/t', to: 'h:/p', prune: false }).map((c) => c.label)).toEqual(
      ['bundles', 'history', 'manifest'],
    );
    expect(buildPullCommand({ from: 'h:/p', to: '/t' }).args).toContain('--delay-updates');
  });

  it('anchors every rsync filter to the release layout so --delete can never reach other files', () => {
    const commands = [
      ...buildPushCommands({ from: '/tree', to: 'h:/srv/bundles' }),
      buildPullCommand({ from: 'h:/srv/bundles', to: '/tree' }),
      buildManifestProbeCommand({ from: 'h:/srv/bundles', to: '/probe' }),
    ];
    for (const { label, args } of commands) {
      const includes = args.filter((a) => a.startsWith('--include='));
      // No unanchored include (such as `*/` or `*.bundle`) may exist in any phase …
      for (const include of includes) {
        expect(include, `${label}: ${include}`).toMatch(/^--include=\/(testing|production)\//);
      }
      // … and everything not included is excluded (and therefore protected from --delete).
      expect(args).toContain('--exclude=*');
    }
    const prune = commands.find((c) => c.label === 'prune')!;
    expect(prune.args.filter((a) => a.startsWith('--include=')).sort()).toEqual([
      '--include=/production/',
      '--include=/production/*/',
      '--include=/production/*/*.bundle',
      '--include=/testing/',
      '--include=/testing/*/',
      '--include=/testing/*/*.bundle',
    ]);
  });

  it('refuses a remote path that is not the release directory (typo / parent directory)', () => {
    const { root } = releasedTree();
    const run = () => ({ status: 0 }) as never;
    for (const bad of [
      'u@h:/srv/site/shared/mobile-updates', // parent of the release directory
      'u@h:/srv/site/shared', // site root
      'u@h:/',
      'u@h:bundles', // relative
      'u@h:/bundles', // too shallow
      'u@h:/srv/site/shared/mobile-updates/bundles-old',
    ]) {
      expect(
        () => syncTrees({ from: root, to: bad, publicKeyPem: pair.publicKeyPem, run } as never),
        bad,
      ).toThrow(/Refusing remote path/);
      expect(
        () =>
          syncTrees({ from: bad, to: dir('into'), publicKeyPem: pair.publicKeyPem, run } as never),
        bad,
      ).toThrow(/Refusing remote path/);
    }
    expect(() =>
      assertBundlesDirectory('u@h:/srv/site/shared/mobile-updates/bundles'),
    ).not.toThrow();
    expect(() =>
      assertBundlesDirectory('u@h:/srv/site/shared/mobile-updates/bundles/'),
    ).not.toThrow();
    // an explicit override exists for unusual layouts
    expect(() =>
      assertBundlesDirectory('u@h:/srv/other', { allowAnyRemotePath: true }),
    ).not.toThrow();
  });

  it('only a verified tree may be pushed to a remote, and a failing rsync stops before the manifest', () => {
    const { root } = releasedTree();
    const calls: string[] = [];
    const run = (_cmd: string, args: string[]) => {
      const probe = !args.includes('--exclude=.release.lock');
      if (probe) {
        const dest = args.at(-1)!; // empty remote: nothing to compare against
        mkdirSync(dest, { recursive: true });
      } else {
        calls.push(args.includes('--ignore-existing') ? 'bundles' : 'later phase');
      }
      return { status: probe ? 0 : 23 } as never;
    };
    expect(() =>
      syncTrees({
        from: root,
        to: 'u@h:/srv/bundles',
        publicKeyPem: pair.publicKeyPem,
        run,
        log: () => undefined,
      } as never),
    ).toThrow(/rsync bundles failed/);
    expect(calls).toEqual(['bundles']); // the manifest rsync never ran
  });

  it('recognises remote specs without mistaking Windows drives or local paths', () => {
    expect(isRemoteSpec('deploy@host:/srv/x')).toBe(true);
    expect(isRemoteSpec('host.example.com:/srv/x')).toBe(true);
    expect(isRemoteSpec('C:\\release\\tree')).toBe(false);
    expect(isRemoteSpec('C:/release/tree')).toBe(false);
    expect(isRemoteSpec('/srv/bundles')).toBe(false);
    expect(isRemoteSpec('./tree')).toBe(false);
  });
});
