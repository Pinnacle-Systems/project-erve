#!/usr/bin/env node
/**
 * Release tooling for self-hosted OTA updates. See OTA_RELEASE_RUNBOOK.md.
 *
 *   publish   build -> selected OTA channel                (needs the private key)
 *   promote   TESTING -> PRODUCTION, same bytes            (needs the private key)
 *   rollback  re-release an earlier build, higher number   (needs the private key)
 *   retire    withdraw web updates for an APK generation   (needs the private key)
 *   status    live releases per channel                    (public key only)
 *   history   signed release history                       (public key only)
 *   verify    verify a tree (--tree) or a live server (--url)
 *   sync      move a tree to/from the server directory     (public key only)
 *
 * Nothing here deploys or contacts a server unless you run `sync` with a remote
 * target or `verify --url`. The private key is read from a FILE outside the
 * repository and is never printed, logged or copied.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import baseConfig from '../capacitor.base-config.mjs';
import { loadOtaBuildConfig, resolveNativeIdentity } from './ota/ota-config.mjs';
import { readMobilePackageVersion } from './ota/native-fingerprint.mjs';
import {
  CHANNELS,
  DEFAULT_RETENTION,
  describeChannel,
  distContainsPrivateKey,
  promoteRelease,
  publishRelease,
  retireGeneration,
  rollbackRelease,
  verifyReleaseTree,
} from './ota/release-store.mjs';
import { syncTrees } from './ota/sync.mjs';
import { verifyRemoteChannel } from './ota/verify-remote.mjs';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(mobileRoot, '..', '..');

function fail(message) {
  console.error(`[ota] ${message}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  allowPositionals: false,
  options: {
    tree: { type: 'string' },
    'private-key-file': { type: 'string' },
    dist: { type: 'string', default: join(mobileRoot, 'dist') },
    channel: { type: 'string' },
    fingerprint: { type: 'string', multiple: true, default: [] },
    build: { type: 'string' },
    'build-number': { type: 'string' },
    'to-build': { type: 'string' },
    reason: { type: 'string' },
    keep: { type: 'string' },
    'latest-native': { type: 'boolean', default: false },
    'allow-dirty': { type: 'boolean', default: false },
    url: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    'no-prune': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-any-remote-path': { type: 'boolean', default: false },
    ssh: { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

function loadConfig() {
  const ota = loadOtaBuildConfig();
  if (!ota.publicKey) fail('no OTA public key configured (apps/mobile/ota/ota-public-key.pem).');
  return ota;
}

function currentFingerprint(ota) {
  return resolveNativeIdentity({ baseConfig, ota }).fingerprint;
}

function oneFingerprint(ota) {
  if (values.fingerprint.length > 1) fail('Pass --fingerprint only once for this command.');
  return values.fingerprint[0] ?? currentFingerprint(ota);
}

function outsideRepo(path) {
  return relative(repoRoot, path).startsWith('..');
}

function treeDir() {
  const tree = values.tree ?? process.env.ERVE_OTA_RELEASE_TREE;
  if (!tree) fail('--tree <release tree dir> (or ERVE_OTA_RELEASE_TREE) is required.');
  const resolved = resolve(tree);
  if (!outsideRepo(resolved))
    fail(`The release tree must be outside the repository (${resolved}).`);
  return resolved;
}

function privateKey() {
  const file = values['private-key-file'] ?? process.env.ERVE_OTA_PRIVATE_KEY_FILE;
  if (!file) fail('--private-key-file (or ERVE_OTA_PRIVATE_KEY_FILE) is required.');
  const resolved = resolve(file);
  if (!outsideRepo(resolved)) fail('The private key file must be outside the repository.');
  if (!existsSync(resolved)) fail(`private key file not found: ${resolved}`);
  const pem = readFileSync(resolved, 'utf8');
  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(pem)) {
    fail('that file is not an unencrypted PEM private key.');
  }
  return pem;
}

function number(name, raw) {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) fail(`--${name} must be a positive integer.`);
  return n;
}

const keep = () => (values.keep ? number('keep', values.keep) : DEFAULT_RETENTION);

function showRelease(label, r) {
  console.log(`[ota] ${label}: ${r.channel}  native ${r.fingerprint}`);
  console.log(
    `[ota]   version ${r.version}  (build ${r.buildNumber}, manifest sequence ${r.sequence})`,
  );
  console.log(
    `[ota]   ${r.sizeBytes} bytes  content ${r.contentSha256.slice(0, 16)}…  commit ${r.sourceCommit ?? 'unknown'}`,
  );
  console.log(`[ota]   latest native generation: ${r.latestNativeFingerprint}`);
  if (values.json) console.log(JSON.stringify(r, null, 2));
}

function printStatus(report) {
  for (const c of report) {
    console.log(`\n[ota] ${c.channel}  (manifest sequence ${c.sequence ?? 'none'})`);
    const live = Object.entries(c.live);
    if (!live.length) console.log('  no live release');
    for (const [fp, r] of live) {
      console.log(`  LIVE  native ${fp}  ${r.version}  commit ${r.sourceCommit ?? '?'}`);
    }
    if (command !== 'history') continue;
    const wanted = (e) => !values.fingerprint.length || values.fingerprint.includes(e.fingerprint);
    for (const e of c.entries.filter(wanted)) {
      const link = e.restores
        ? ` restores build ${e.restores.buildNumber}`
        : e.from
          ? ` from ${e.from.channel} build ${e.from.buildNumber}`
          : '';
      console.log(
        `  #${String(e.id).padStart(3)} ${e.at}  ${e.action.padEnd(9)} native ${e.fingerprint}  ` +
          `build ${e.buildNumber ?? '-'}${link}${e.isLive ? '  [LIVE]' : ''}` +
          `${e.restorable ? '  [restorable]' : ''}${e.reason ? `  reason: ${e.reason}` : ''}`,
      );
    }
  }
}

async function main() {
  switch (command) {
    case 'publish': {
      if (values.channel && !CHANNELS.includes(values.channel)) {
        fail('--channel must be testing or production.');
      }
      const ota = loadConfig();
      if (!ota.enabled) fail(`OTA is not configured: ${ota.disabledReason}`);
      const dist = resolve(values.dist);
      if (distContainsPrivateKey(dist)) fail('dist/ contains private key material. Aborting.');
      const result = publishRelease({
        distDir: dist,
        root: treeDir(),
        channel: values.channel ?? 'testing',
        fingerprint: currentFingerprint(ota),
        appVersion: readMobilePackageVersion(mobileRoot),
        publicKeyPem: ota.publicKey,
        privateKeyPem: privateKey(),
        buildNumber: values['build-number']
          ? number('build-number', values['build-number'])
          : undefined,
        latestNative: values['latest-native'] || undefined,
        retention: keep(),
      });
      showRelease('published', result);
      break;
    }
    case 'promote': {
      const ota = loadConfig();
      if (!values.build) fail('--build <testing build number> is required (see `status`).');
      const result = promoteRelease({
        root: treeDir(),
        fingerprint: oneFingerprint(ota),
        build: number('build', values.build),
        allowDirty: values['allow-dirty'],
        latestNative: values['latest-native'] || undefined,
        publicKeyPem: ota.publicKey,
        privateKeyPem: privateKey(),
        retention: keep(),
      });
      showRelease('promoted', result);
      break;
    }
    case 'rollback': {
      const ota = loadConfig();
      if (!values.channel) fail('--channel testing|production is required.');
      if (!values['to-build']) {
        fail('--to-build <earlier build number> is required (see `history`).');
      }
      const result = rollbackRelease({
        root: treeDir(),
        channel: values.channel,
        fingerprint: oneFingerprint(ota),
        toBuild: number('to-build', values['to-build']),
        reason: values.reason,
        latestNative: values['latest-native'] || undefined,
        publicKeyPem: ota.publicKey,
        privateKeyPem: privateKey(),
        retention: keep(),
      });
      showRelease(`rolled back (content of build ${values['to-build']})`, result);
      break;
    }
    case 'retire': {
      const ota = loadConfig();
      if (!values.channel) fail('--channel testing|production is required.');
      if (!values.fingerprint.length) fail('--fingerprint <native fingerprint> is required.');
      const result = retireGeneration({
        root: treeDir(),
        channel: values.channel,
        fingerprints: values.fingerprint,
        reason: values.reason,
        publicKeyPem: ota.publicKey,
        privateKeyPem: privateKey(),
      });
      console.log(
        `[ota] retired ${result.retired.join(', ')} in ${result.channel} (sequence ${result.sequence})`,
      );
      break;
    }
    case 'status':
    case 'history': {
      const ota = loadConfig();
      const root = treeDir();
      const channels = values.channel ? [values.channel] : CHANNELS;
      const report = channels.map((channel) => describeChannel(root, channel, ota.publicKey));
      if (values.json) console.log(JSON.stringify(report, null, 2));
      else printStatus(report);
      break;
    }
    case 'verify': {
      const ota = loadConfig();
      if (values.url) {
        const channels = values.channel ? [values.channel] : ['production'];
        let bad = false;
        for (const channel of channels) {
          const result = await verifyRemoteChannel({
            baseUrl: values.url,
            channel,
            publicKeyPem: ota.publicKey,
            fingerprint: values.fingerprint[0],
          });
          console.log(`[ota] ${channel}: ${result.ok ? 'OK' : 'FAILED'}`);
          for (const [fp, r] of Object.entries(result.releases)) {
            console.log(`[ota]   ${fp}  ${r.version}`);
          }
          for (const problem of result.problems) console.error(`[ota]   problem: ${problem}`);
          bad ||= !result.ok;
        }
        if (bad) process.exit(1);
        break;
      }
      const summary = verifyReleaseTree(treeDir(), ota.publicKey, {
        channels: values.channel ? [values.channel] : CHANNELS,
      });
      for (const [channel, s] of Object.entries(summary)) {
        console.log(
          `[ota] ${channel}: OK — sequence ${s.sequence}, ${s.historyEntries} history entries`,
        );
        for (const [fp, r] of Object.entries(s.releases)) {
          console.log(`[ota]   ${fp}  ${r.version}  (${r.files} files)`);
        }
      }
      if (!Object.keys(summary).length) fail('no channel with a manifest found in the tree.');
      break;
    }
    case 'sync': {
      const ota = loadConfig();
      if (!values.from || !values.to) fail('--from <src> and --to <dest> are required.');
      const result = syncTrees({
        from: values.from,
        to: values.to,
        publicKeyPem: ota.publicKey,
        prune: !values['no-prune'],
        dryRun: values['dry-run'],
        sshCommand: values.ssh,
        allowAnyRemotePath: values['allow-any-remote-path'],
      });
      console.log(`[ota] sync (${result.mode}) done.`);
      if (result.copied) {
        console.log(
          `[ota]   new bundle files: ${result.copied.length}, pruned: ${result.pruned.length}`,
        );
      }
      break;
    }
    default:
      fail(
        `Unknown command "${command ?? ''}". Use: publish | promote | rollback | retire | status | history | verify | sync`,
      );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
