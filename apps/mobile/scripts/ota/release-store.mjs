/**
 * Builds, signs, promotes, rolls back and verifies an OTA release tree. Pure
 * functions over a directory so the exact same code runs in the release CLI,
 * the verifier and the tests.
 *
 * Tree (this is what is synced to <DEPLOY_ROOT>/shared/mobile-updates/bundles/):
 *
 *   <channel>/manifest.json                 signed envelope — what devices read (mutable)
 *   <channel>/history.json                  signed envelope — release audit log (mutable)
 *   <channel>/<fingerprint>/<build>.bundle  AES-encrypted, RSA-authenticated zip (IMMUTABLE)
 *
 * <channel> is "testing" or "production" and the two are fully self-contained:
 * nothing in one channel's directory is ever referenced by the other, so
 * pruning, rolling back or retiring in one cannot affect the other.
 *
 * Release model
 *  - `publish`  puts a fresh build into TESTING only (production cannot be
 *               published to directly — see assertTesting()).
 *  - `promote`  copies the exact tested bytes, checksum and session key from
 *               TESTING to PRODUCTION under a new, higher production build
 *               number. Nothing is rebuilt or re-encrypted.
 *  - `rollback` re-releases the bytes of an EARLIER release of the same channel
 *               under a NEW, higher build number and a higher manifest
 *               sequence. Devices only ever move forward (a downgrade-proof
 *               rule the app enforces), so "going back" is a new release that
 *               happens to carry old content.
 *
 * Every state change follows the same crash-safe order, so no device can read
 * a manifest that points at a file that is not there or does not verify:
 *   1. write the bundle file (exclusive; an existing build file is never overwritten)
 *   2. verify it exactly as a device would (decrypt, checksum, fingerprint)
 *   3. atomically replace manifest.json
 *   4. append to history.json
 * A failure before step 3 leaves the channel exactly as it was and removes the
 * orphan file. A crash between 3 and 4 is repaired on the next operation.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import {
  decryptBundle,
  encryptBundle,
  keysMatch,
  sha256Hex,
  signManifest,
  verifyManifestEnvelope,
} from './bundle-crypto.mjs';

export const MANIFEST_SCHEMA = 1;
export const HISTORY_SCHEMA = 1;
export const CHANNELS = ['testing', 'production'];
export const DEFAULT_RETENTION = 10;
const MAX_BUNDLE_BYTES = 150 * 1024 * 1024;
const FIXED_ZIP_MTIME = Date.UTC(2000, 0, 1);
const FINGERPRINT_RE = /^[0-9a-f]{32}$/;
// A PEM private-key header followed by a real key body (not just a string
// literal naming the format inside some library).
const PRIVATE_KEY_MARKER = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[A-Za-z0-9+/=\s\\]{200,}/;
const BUNDLE_URL_RE = /^([0-9a-f]{32})\/(\d+)\.bundle$/;

export function assertChannel(channel) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`Unknown channel "${channel}" (expected ${CHANNELS.join(' or ')}).`);
  }
}

function assertFingerprint(fingerprint) {
  if (!FINGERPRINT_RE.test(fingerprint ?? '')) {
    throw new Error(`"${fingerprint}" is not a native fingerprint (32 hex characters).`);
  }
}

// ---- files -------------------------------------------------------------

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Deterministic zip of a dist directory, with the Capgo packaging rules enforced. */
export function zipDist(distDir) {
  const entries = {};
  for (const file of walk(distDir).sort()) {
    const name = relative(distDir, file).split(sep).join('/');
    if (name.split('/').some((part) => part.startsWith('.'))) {
      throw new Error(`Refusing to bundle hidden file: ${name}`);
    }
    const bytes = readFileSync(file);
    // A signing key must never travel inside a bundle (bundles are only
    // authenticated, not secret: the decryption key is derivable from the
    // public key shipped in every APK).
    if (bytes.length < 5_000_000 && PRIVATE_KEY_MARKER.test(bytes.toString('latin1'))) {
      throw new Error(`Refusing to bundle ${name}: it contains private key material.`);
    }
    entries[name] = [new Uint8Array(bytes), { level: 9, mtime: FIXED_ZIP_MTIME }];
  }
  if (!entries['index.html']) throw new Error('dist/ has no index.html at its root');
  return Buffer.from(zipSync(entries));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readBuildInfo(distDir) {
  const infoPath = join(distDir, 'ota-build-info.json');
  if (!existsSync(infoPath)) {
    throw new Error(
      'dist/ has no ota-build-info.json — rebuild with `pnpm --filter @erve/mobile build`.',
    );
  }
  return readJson(infoPath);
}

const channelDir = (root, channel) => join(root, channel);
const manifestPath = (root, channel) => join(root, channel, 'manifest.json');
const historyPath = (root, channel) => join(root, channel, 'history.json');
const bundleRelativeUrl = (fingerprint, build) => `${fingerprint}/${build}.bundle`;
const bundlePathFor = (root, channel, fingerprint, build) =>
  join(root, channel, fingerprint, `${build}.bundle`);

/** write-then-rename so a reader never observes a half-written file. */
function writeAtomic(path, data) {
  mkdirSync(join(path, '..'), { recursive: true });
  const staging = `${path}.tmp-${process.pid}`;
  writeFileSync(staging, data);
  renameSync(staging, path);
}

/** Bundle files are immutable: creating one that already exists is an error. */
function writeBundleExclusive(path, data) {
  if (existsSync(path)) {
    throw new Error(`${path} already exists; release bundles are immutable and never overwritten.`);
  }
  writeAtomic(path, data);
}

function writeSigned(path, payload, privateKeyPem) {
  writeAtomic(path, `${JSON.stringify(signManifest(payload, privateKeyPem), null, 2)}\n`);
}

function readSigned(path, publicKeyPem) {
  if (!existsSync(path)) return null;
  // A signed file that does not verify is never silently overwritten: it means
  // a different key, or a corrupted/tampered release tree.
  return verifyManifestEnvelope(readJson(path), publicKeyPem);
}

/** One operator at a time per tree. */
function withLock(root, fn) {
  const lock = join(root, '.release.lock');
  mkdirSync(root, { recursive: true });
  try {
    mkdirSync(lock);
  } catch {
    throw new Error(
      `Another release operation holds ${lock}. If none is running (it crashed), remove that directory and retry.`,
    );
  }
  try {
    return fn();
  } finally {
    rmdirSync(lock);
  }
}

// ---- state -------------------------------------------------------------

function emptyHistory(channel) {
  return { schema: HISTORY_SCHEMA, channel, entries: [] };
}

/**
 * Loads (and verifies) manifest + history for a channel. A manifest release
 * with no history entry (crash between manifest and history writes) is
 * recorded as `recovered` so the log never silently misses a live release.
 */
function loadState(root, channel, publicKeyPem) {
  const manifest = readSigned(manifestPath(root, channel), publicKeyPem);
  if (manifest && manifest.channel !== channel) {
    throw new Error(`${manifestPath(root, channel)} is for channel "${manifest.channel}".`);
  }
  const history = readSigned(historyPath(root, channel), publicKeyPem) ?? emptyHistory(channel);
  if (history.channel !== channel) {
    throw new Error(`${historyPath(root, channel)} is for channel "${history.channel}".`);
  }
  for (const [fingerprint, release] of Object.entries(manifest?.releases ?? {})) {
    if (
      !history.entries.some(
        (e) => e.fingerprint === fingerprint && e.buildNumber === release.buildNumber,
      )
    ) {
      history.entries.push({
        id: history.entries.length + 1,
        at: release.createdAt,
        action: 'recovered',
        fingerprint,
        buildNumber: release.buildNumber,
        version: release.version,
        fileSha256: release.fileSha256 ?? null,
        contentSha256: release.contentSha256 ?? null,
        sizeBytes: release.sizeBytes,
        checksum: release.checksum,
        sessionKey: release.sessionKey,
        manifestSequence: manifest.sequence,
      });
    }
  }
  return { manifest, history };
}

function highestBuild(history, manifest, fingerprint) {
  let highest = manifest?.releases?.[fingerprint]?.buildNumber ?? 0;
  for (const entry of history.entries) {
    if (entry.fingerprint === fingerprint) highest = Math.max(highest, entry.buildNumber);
  }
  return highest;
}

function nextBuildNumber(history, manifest, fingerprint, now, requested) {
  const previous = highestBuild(history, manifest, fingerprint);
  const buildNumber = requested ?? Math.max(Math.floor(now / 1000), previous + 1);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= previous) {
    throw new Error(`buildNumber ${buildNumber} must be greater than the previous ${previous}.`);
  }
  return buildNumber;
}

/** Decrypts and structurally validates one sealed bundle exactly as a device would. */
export function verifyBundleBuffer(encrypted, release, publicKeyPem) {
  if (encrypted.length !== release.sizeBytes) {
    throw new Error(`size ${encrypted.length} != manifest ${release.sizeBytes}`);
  }
  const fileSha256 = sha256Hex(encrypted);
  if (release.fileSha256 && release.fileSha256 !== fileSha256) {
    throw new Error('file hash differs from the signed manifest (file was modified)');
  }
  const zip = decryptBundle(encrypted, release, publicKeyPem);
  const entries = unzipSync(new Uint8Array(zip));
  if (!entries['index.html']) throw new Error('bundle has no index.html');
  const info = entries['ota-build-info.json']
    ? JSON.parse(Buffer.from(entries['ota-build-info.json']).toString('utf8'))
    : {};
  return {
    files: Object.keys(entries).length,
    nativeFingerprint: info.nativeFingerprint ?? null,
    sourceCommit: info.sourceCommit ?? null,
    fileSha256,
    contentSha256: sha256Hex(zip),
  };
}

/** verifyBundleBuffer for a release file inside a tree. */
export function verifyReleaseFile(root, channel, release, publicKeyPem) {
  if (!BUNDLE_URL_RE.test(release.url)) {
    throw new Error(`${release.url}: not a <fingerprint>/<build>.bundle path`);
  }
  const file = join(root, channel, ...release.url.split('/'));
  try {
    return verifyBundleBuffer(readFileSync(file), release, publicKeyPem);
  } catch (error) {
    throw new Error(`${release.url}: ${error.message}`, { cause: error });
  }
}

function commitManifest({
  root,
  channel,
  state,
  fingerprint,
  release,
  retire = [],
  latestNative,
  autoLatest,
  now,
  privateKeyPem,
}) {
  const previous = state.manifest;
  const releases = { ...(previous?.releases ?? {}), [fingerprint]: release };
  for (const retired of retire) delete releases[retired];
  // The newest APK generation: explicit, or a brand-new fingerprint appearing
  // via publish/promote. A rollback never changes it unless asked to.
  const isNewGeneration = !previous || !(fingerprint in previous.releases);
  let latestNativeFingerprint = previous?.latestNativeFingerprint ?? fingerprint;
  if (latestNative || (autoLatest && isNewGeneration)) latestNativeFingerprint = fingerprint;
  const payload = {
    schema: MANIFEST_SCHEMA,
    channel,
    // Strictly greater than any manifest this tree ever signed: a device that
    // has seen sequence S refuses anything lower, so a rollback manifest
    // (which carries OLD content) must still carry a NEW sequence.
    sequence: Math.max(now, (state.manifest?.sequence ?? 0) + 1),
    generatedAt: new Date(now).toISOString(),
    latestNativeFingerprint,
    releases,
  };
  writeSigned(manifestPath(root, channel), payload, privateKeyPem);
  return payload;
}

function appendHistory({ root, channel, state, entry, privateKeyPem }) {
  state.history.entries.push({ id: state.history.entries.length + 1, ...entry });
  writeSigned(historyPath(root, channel), state.history, privateKeyPem);
}

/**
 * Shared write path for publish / promote / rollback.
 * `source` is { encrypted, checksum, sessionKey } — the sealed bundle to release.
 */
function release({
  root,
  channel,
  fingerprint,
  appVersion,
  source,
  action,
  details,
  retire,
  latestNative,
  now,
  requestedBuild,
  publicKeyPem,
  privateKeyPem,
  retention,
  hooks,
}) {
  assertChannel(channel);
  assertFingerprint(fingerprint);
  if (!keysMatch(publicKeyPem, privateKeyPem)) {
    throw new Error('The private key does not match the OTA public key compiled into the app.');
  }
  if (source.encrypted.length > MAX_BUNDLE_BYTES)
    throw new Error('Bundle exceeds the 150 MB limit.');

  const state = loadState(root, channel, publicKeyPem);
  const buildNumber = nextBuildNumber(
    state.history,
    state.manifest,
    fingerprint,
    now,
    requestedBuild,
  );
  const bundlePath = bundlePathFor(root, channel, fingerprint, buildNumber);
  const record = {
    version: `${appVersion}-ota.${buildNumber}`,
    buildNumber,
    url: bundleRelativeUrl(fingerprint, buildNumber),
    checksum: source.checksum,
    sessionKey: source.sessionKey,
    sizeBytes: source.encrypted.length,
    createdAt: new Date(now).toISOString(),
    fileSha256: sha256Hex(source.encrypted),
  };

  writeBundleExclusive(bundlePath, source.encrypted);
  try {
    // Verify exactly what a device would, BEFORE exposing anything.
    const checked = verifyReleaseFile(root, channel, record, publicKeyPem);
    if (checked.nativeFingerprint !== fingerprint) {
      throw new Error(
        'Self-check failed: bundle build info does not match the target fingerprint.',
      );
    }
    record.contentSha256 = checked.contentSha256;
    if (checked.sourceCommit) record.sourceCommit = checked.sourceCommit;
    if (details?.origin) record.origin = details.origin;
    hooks?.beforeManifest?.(record);
    const payload = commitManifest({
      root,
      channel,
      state,
      fingerprint,
      release: record,
      retire,
      latestNative,
      autoLatest: action !== 'rollback',
      now,
      privateKeyPem,
    });
    appendHistory({
      root,
      channel,
      state,
      privateKeyPem,
      entry: {
        at: record.createdAt,
        action,
        fingerprint,
        buildNumber,
        version: record.version,
        fileSha256: record.fileSha256,
        contentSha256: record.contentSha256,
        sizeBytes: record.sizeBytes,
        sourceCommit: record.sourceCommit ?? null,
        // Signature material is kept so a rollback can re-release this exact
        // build later (the manifest only carries the current release).
        checksum: record.checksum,
        sessionKey: record.sessionKey,
        manifestSequence: payload.sequence,
        ...(details ?? {}),
      },
    });
    prune(root, channel, state, retention ?? DEFAULT_RETENTION);
    return {
      channel,
      fingerprint,
      buildNumber,
      version: record.version,
      sizeBytes: record.sizeBytes,
      latestNativeFingerprint: payload.latestNativeFingerprint,
      sequence: payload.sequence,
      bundlePath,
      contentSha256: record.contentSha256,
      fileSha256: record.fileSha256,
      sourceCommit: record.sourceCommit ?? null,
    };
  } catch (error) {
    // Nothing was exposed: remove the orphan so a retry starts clean.
    const referenced = Object.values(
      readSigned(manifestPath(root, channel), publicKeyPem)?.releases ?? {},
    ).some((r) => r.url === record.url);
    if (!referenced) rmSync(bundlePath, { force: true });
    throw error;
  }
}

// ---- operations ----------------------------------------------------------

/**
 * Seals a built dist/ and publishes it to the selected OTA channel.
 *
 * @param {object} o
 * @param {string} o.distDir
 * @param {string} o.root                 release tree root
 * @param {string} o.fingerprint          native fingerprint the dist must target
 * @param {string} o.appVersion
 * @param {string} o.publicKeyPem
 * @param {string} o.privateKeyPem
 * @param {string} [o.channel]            "testing" (default) or "production"
 * @param {number} [o.buildNumber]
 * @param {boolean} [o.latestNative]
 * @param {number} [o.retention]
 * @param {number} [o.now]
 */
export function publishRelease(o) {
  const channel = o.channel ?? 'testing';
  assertChannel(channel);
  const info = readBuildInfo(o.distDir);
  if (info.nativeFingerprint !== o.fingerprint) {
    throw new Error(
      `dist/ was built for native fingerprint ${info.nativeFingerprint || '(none)'} but the current ` +
        `native sources hash to ${o.fingerprint}. Rebuild the web bundle before publishing.`,
    );
  }
  return withLock(o.root, () => {
    const zip = zipDist(o.distDir);
    const sealed = encryptBundle(zip, o.privateKeyPem);
    return release({
      root: o.root,
      channel,
      fingerprint: o.fingerprint,
      appVersion: o.appVersion,
      source: sealed,
      action: 'publish',
      latestNative: o.latestNative,
      now: o.now ?? Date.now(),
      requestedBuild: o.buildNumber,
      publicKeyPem: o.publicKeyPem,
      privateKeyPem: o.privateKeyPem,
      retention: o.retention,
      hooks: o.hooks,
    });
  });
}

function appVersionOf(version) {
  return version.replace(/-ota\.\d+$/, '');
}

function readSealed(root, channel, rel) {
  return {
    encrypted: readFileSync(join(root, channel, ...rel.url.split('/'))),
    checksum: rel.checksum,
    sessionKey: rel.sessionKey,
  };
}

/**
 * Releases the CURRENT testing build of `fingerprint` to production. The exact
 * tested bytes (and their signature material) are copied; nothing is rebuilt.
 *
 * @param {object} o
 * @param {string} o.root
 * @param {string} o.fingerprint
 * @param {number} o.build            testing build number being promoted — required, so a
 *                                    promotion can never silently pick up "whatever is latest"
 * @param {boolean} [o.allowDirty]    promote a build made from uncommitted changes
 * @param {boolean} [o.latestNative]
 */
export function promoteRelease(o) {
  assertFingerprint(o.fingerprint);
  return withLock(o.root, () => {
    const testing = loadState(o.root, 'testing', o.publicKeyPem);
    const source = testing.manifest?.releases?.[o.fingerprint];
    if (!source) throw new Error(`The testing channel has no release for native ${o.fingerprint}.`);
    if (source.buildNumber !== o.build) {
      throw new Error(
        `Testing build ${o.build} is not the build currently published for ${o.fingerprint} ` +
          `(that is ${source.buildNumber}). Only the build testers actually received can be promoted.`,
      );
    }
    const checked = verifyReleaseFile(o.root, 'testing', source, o.publicKeyPem);
    if (checked.nativeFingerprint !== o.fingerprint) {
      throw new Error('The testing bundle targets a different native layer than its release key.');
    }
    if (String(checked.sourceCommit ?? '').endsWith('+dirty') && !o.allowDirty) {
      throw new Error(
        `Testing build ${o.build} was built from uncommitted changes (${checked.sourceCommit}). ` +
          'Publish a clean build to testing, or pass --allow-dirty to promote it anyway.',
      );
    }
    const production = loadState(o.root, 'production', o.publicKeyPem);
    const live = production.manifest?.releases?.[o.fingerprint];
    if (live && live.fileSha256 === checked.fileSha256) {
      throw new Error(`Production already serves exactly this bundle (build ${live.buildNumber}).`);
    }
    return release({
      root: o.root,
      channel: 'production',
      fingerprint: o.fingerprint,
      appVersion: appVersionOf(source.version),
      source: readSealed(o.root, 'testing', source),
      action: 'promote',
      details: {
        from: { channel: 'testing', buildNumber: source.buildNumber },
        origin: { channel: 'testing', buildNumber: source.buildNumber },
      },
      latestNative: o.latestNative,
      now: o.now ?? Date.now(),
      publicKeyPem: o.publicKeyPem,
      privateKeyPem: o.privateKeyPem,
      retention: o.retention,
      hooks: o.hooks,
    });
  });
}

/**
 * Re-releases an earlier release of the same channel under a NEW build number
 * and a NEW (higher) manifest sequence.
 *
 * @param {object} o
 * @param {string} o.root
 * @param {string} o.channel
 * @param {string} o.fingerprint
 * @param {number} o.toBuild          earlier build whose content should be live again
 * @param {string} o.reason           recorded in the signed history
 */
export function rollbackRelease(o) {
  assertChannel(o.channel);
  assertFingerprint(o.fingerprint);
  if (!o.reason || !o.reason.trim())
    throw new Error('A rollback needs a --reason (it is recorded in the history).');
  return withLock(o.root, () => {
    const state = loadState(o.root, o.channel, o.publicKeyPem);
    const target = state.history.entries.find(
      (e) => e.fingerprint === o.fingerprint && e.buildNumber === o.toBuild,
    );
    if (!target) {
      throw new Error(
        `${o.channel} has no recorded build ${o.toBuild} for native ${o.fingerprint}.`,
      );
    }
    const file = bundlePathFor(o.root, o.channel, o.fingerprint, o.toBuild);
    if (!existsSync(file)) {
      throw new Error(
        `Build ${o.toBuild}'s file was pruned by retention and can no longer be restored.`,
      );
    }
    const current = state.manifest?.releases?.[o.fingerprint];
    if (current && current.buildNumber === o.toBuild) {
      throw new Error(`Build ${o.toBuild} is already the live release.`);
    }
    // The signature material for an old build is not in the manifest any more;
    // it is recovered from the signed history entry that recorded it.
    const material = target.checksum && target.sessionKey ? target : null;
    if (!material) {
      throw new Error(
        `History for build ${o.toBuild} holds no signature material; cannot restore.`,
      );
    }
    const sealed = {
      encrypted: readFileSync(file),
      checksum: material.checksum,
      sessionKey: material.sessionKey,
    };
    if (sha256Hex(sealed.encrypted) !== target.fileSha256) {
      throw new Error(
        `Build ${o.toBuild}'s file does not match its recorded hash; refusing to restore it.`,
      );
    }
    return release({
      root: o.root,
      channel: o.channel,
      fingerprint: o.fingerprint,
      appVersion: appVersionOf(target.version),
      source: sealed,
      action: 'rollback',
      details: {
        restores: { buildNumber: o.toBuild },
        origin: { channel: o.channel, buildNumber: o.toBuild },
        reason: o.reason.trim(),
      },
      latestNative: o.latestNative,
      now: o.now ?? Date.now(),
      publicKeyPem: o.publicKeyPem,
      privateKeyPem: o.privateKeyPem,
      retention: o.retention,
      hooks: o.hooks,
    });
  });
}

/** Withdraws web updates for one or more APK generations (their devices keep what they have). */
export function retireGeneration(o) {
  assertChannel(o.channel);
  if (!o.reason || !o.reason.trim()) throw new Error('Retiring needs a --reason.');
  return withLock(o.root, () => {
    const state = loadState(o.root, o.channel, o.publicKeyPem);
    if (!state.manifest) throw new Error(`${o.channel} has no manifest.`);
    const remaining = { ...state.manifest.releases };
    for (const fingerprint of o.fingerprints) {
      if (!(fingerprint in remaining))
        throw new Error(`${fingerprint} has no live release in ${o.channel}.`);
      delete remaining[fingerprint];
    }
    const now = o.now ?? Date.now();
    const payload = {
      ...state.manifest,
      sequence: Math.max(now, state.manifest.sequence + 1),
      generatedAt: new Date(now).toISOString(),
      releases: remaining,
    };
    writeSigned(manifestPath(o.root, o.channel), payload, o.privateKeyPem);
    for (const fingerprint of o.fingerprints) {
      appendHistory({
        root: o.root,
        channel: o.channel,
        state,
        privateKeyPem: o.privateKeyPem,
        entry: {
          at: new Date(now).toISOString(),
          action: 'retire',
          fingerprint,
          buildNumber: null,
          version: null,
          manifestSequence: payload.sequence,
          reason: o.reason.trim(),
        },
      });
    }
    return { channel: o.channel, sequence: payload.sequence, retired: o.fingerprints };
  });
}

// ---- retention -----------------------------------------------------------

/**
 * Keeps the newest `keep` bundle files per fingerprint (plus whatever the
 * manifest references). History entries are never removed; entries whose file
 * was pruned are reported as not restorable.
 */
function prune(root, channel, state, keep) {
  const dir = channelDir(root, channel);
  const live = new Set(Object.values(state.manifest?.releases ?? {}).map((r) => r.url));
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !FINGERPRINT_RE.test(entry.name)) continue;
    const files = readdirSync(join(dir, entry.name))
      .filter((file) => /^\d+\.bundle$/.test(file))
      .map((file) => ({ file, build: Number.parseInt(file, 10) }))
      .sort((a, b) => b.build - a.build);
    const keepSet = new Set(files.slice(0, keep).map((f) => f.file));
    for (const { file } of files) {
      if (keepSet.has(file) || live.has(`${entry.name}/${file}`)) continue;
      rmSync(join(dir, entry.name, file));
    }
  }
}

// ---- reporting -----------------------------------------------------------

/**
 * Status + history for a channel, verified against the public key.
 * Each history row says whether its file still exists (rollback candidate).
 */
export function describeChannel(root, channel, publicKeyPem) {
  assertChannel(channel);
  const { manifest, history } = loadState(root, channel, publicKeyPem);
  const live = manifest?.releases ?? {};
  return {
    channel,
    sequence: manifest?.sequence ?? null,
    latestNativeFingerprint: manifest?.latestNativeFingerprint ?? null,
    live,
    entries: history.entries.map(({ checksum: _c, sessionKey: _k, ...entry }) => ({
      ...entry,
      isLive: live[entry.fingerprint]?.buildNumber === entry.buildNumber,
      restorable:
        entry.buildNumber != null &&
        entry.action !== 'retire' &&
        existsSync(bundlePathFor(root, channel, entry.fingerprint, entry.buildNumber)),
    })),
  };
}

// ---- verification ----------------------------------------------------------

/**
 * Verifies the whole tree the way devices and operators rely on it. Throws on
 * the first problem; returns a summary otherwise.
 */
export function verifyReleaseTree(root, publicKeyPem, { channels = CHANNELS } = {}) {
  const summary = {};
  for (const channel of channels) {
    assertChannel(channel);
    const mPath = manifestPath(root, channel);
    if (!existsSync(mPath)) continue;
    const manifest = verifyManifestEnvelope(readJson(mPath), publicKeyPem);
    if (manifest.channel !== channel) {
      throw new Error(
        `${mPath} claims channel "${manifest.channel}" (channel isolation violated).`,
      );
    }
    const history = readSigned(historyPath(root, channel), publicKeyPem);
    if (!history) throw new Error(`${channel}: history.json is missing.`);
    if (history.channel !== channel)
      throw new Error(`${channel}: history.json belongs to "${history.channel}".`);
    let lastSequence = 0;
    const lastBuild = {};
    for (const entry of history.entries) {
      if (entry.manifestSequence < lastSequence) {
        throw new Error(`${channel}: history sequence goes backwards at entry ${entry.id}.`);
      }
      lastSequence = entry.manifestSequence;
      if (entry.buildNumber != null) {
        if ((lastBuild[entry.fingerprint] ?? 0) >= entry.buildNumber) {
          throw new Error(
            `${channel}: build numbers for ${entry.fingerprint} are not strictly increasing at entry ${entry.id}.`,
          );
        }
        lastBuild[entry.fingerprint] = entry.buildNumber;
      }
    }
    if (history.entries.length && lastSequence > manifest.sequence) {
      throw new Error(
        `${channel}: history is newer than the manifest (stale or rolled-back manifest).`,
      );
    }
    const releases = {};
    for (const [fingerprint, rel] of Object.entries(manifest.releases)) {
      assertFingerprint(fingerprint);
      if (rel.url !== bundleRelativeUrl(fingerprint, rel.buildNumber)) {
        throw new Error(`${channel}: release url ${rel.url} does not match its fingerprint/build.`);
      }
      const checked = verifyReleaseFile(root, channel, rel, publicKeyPem);
      if (checked.nativeFingerprint !== fingerprint) {
        throw new Error(
          `${rel.url}: bundle targets ${checked.nativeFingerprint}, not ${fingerprint}`,
        );
      }
      releases[fingerprint] = {
        version: rel.version,
        files: checked.files,
        sourceCommit: checked.sourceCommit,
      };
    }
    for (const stray of walk(channelDir(root, channel))) {
      if (/\.tmp-\d+$/.test(stray)) throw new Error(`${channel}: leftover partial file ${stray}.`);
    }
    summary[channel] = {
      sequence: manifest.sequence,
      latestNativeFingerprint: manifest.latestNativeFingerprint,
      releases,
      historyEntries: history.entries.length,
    };
  }
  return summary;
}

/** Whether a built dist/ contains private key material (publish pre-flight / audit). */
export function distContainsPrivateKey(distDir) {
  return walk(distDir).some((file) =>
    PRIVATE_KEY_MARKER.test(readFileSync(file).toString('latin1')),
  );
}
