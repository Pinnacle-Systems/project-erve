/**
 * Moves a release tree between a release workstation and the server's
 * `shared/mobile-updates/bundles/` directory in an order that can never expose
 * a half-published release:
 *
 *   1. immutable bundle files   (new names only; an existing file is never touched)
 *   2. history.json
 *   3. manifest.json            (atomic rename — the single "activation" step)
 *   4. optional pruning of bundle files the source no longer has
 *
 * Nothing becomes visible to devices until step 3, and step 3 is only reached
 * after every bundle the new manifest references verified at the destination.
 *
 * The destination is either a local directory (this module copies and verifies
 * it itself) or an `[user@]host:/path` rsync target (this module only builds
 * the rsync invocations; they are run without a shell).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { sha256Hex, verifyManifestEnvelope } from './bundle-crypto.mjs';
import { CHANNELS, verifyReleaseFile, verifyReleaseTree } from './release-store.mjs';

const FINGERPRINT_RE = /^[0-9a-f]{32}$/;

/** `host:/path` or `user@host:/path`, but not a Windows drive such as `C:\x`. */
export function isRemoteSpec(spec) {
  return /^(?:[^@\s/\\]+@)?[^:\s/\\]{2,}:[^\\]/.test(spec) && !/^[A-Za-z]:[\\/]/.test(spec);
}

function withTrailingSlash(path) {
  return path.endsWith('/') ? path : `${path}/`;
}

/**
 * Remote targets must be the release directory itself. `rsync --delete` is
 * scoped by the filters below, but a path that is merely *near* the release
 * directory (its parent, the site root) is still almost certainly a typo, so it
 * is refused outright unless the operator says otherwise.
 */
export function assertBundlesDirectory(spec, { allowAnyRemotePath = false } = {}) {
  if (allowAnyRemotePath) return;
  const path = spec.slice(spec.indexOf(':') + 1);
  const segments = path.split('/').filter(Boolean);
  if (!path.startsWith('/') || segments.length < 2 || segments.at(-1) !== 'bundles') {
    throw new Error(
      `Refusing remote path "${path}": it must be the absolute release directory, ending in ` +
        '"/bundles" (e.g. <DEPLOY_ROOT>/shared/mobile-updates/bundles). ' +
        'Pass --allow-any-remote-path only if you are certain.',
    );
  }
}

/**
 * Anchored rsync filters. Every transfer is limited to the release layout
 * `<channel>/<native-fingerprint>/<build>.bundle` plus `<channel>/{history,manifest}.json`.
 * Filters are anchored at the transfer root, so a file that merely happens to be
 * called `*.bundle` somewhere else under the destination — or any other file at
 * all — is neither copied nor, crucially, deleted by `--delete`.
 */
function layoutFilters({ bundles = false, names = [] }) {
  const rules = [];
  for (const channel of CHANNELS) {
    rules.push(`--include=/${channel}/`);
    if (bundles) rules.push(`--include=/${channel}/*/`, `--include=/${channel}/*/*.bundle`);
    for (const name of names) rules.push(`--include=/${channel}/${name}`);
  }
  return [...rules, '--exclude=*', '--prune-empty-dirs'];
}

/**
 * rsync invocations for pushing a verified local tree to a remote one.
 * Exposed (and unit tested) separately from execution.
 */
export function buildPushCommands({ from, to, prune = true, sshCommand }) {
  const base = ['-a', '--exclude=.release.lock', ...(sshCommand ? ['-e', sshCommand] : [])];
  const src = withTrailingSlash(from);
  const dest = withTrailingSlash(to);
  const commands = [
    // 1. Immutable bundles. --ignore-existing: a name that exists remotely is never rewritten.
    {
      label: 'bundles',
      args: [...base, '--ignore-existing', ...layoutFilters({ bundles: true }), src, dest],
    },
    // 2. History, then 3. the manifest last (rsync writes a temp file and renames).
    { label: 'history', args: [...base, ...layoutFilters({ names: ['history.json'] }), src, dest] },
    {
      label: 'manifest',
      args: [...base, ...layoutFilters({ names: ['manifest.json'] }), src, dest],
    },
  ];
  if (prune) {
    // Only bundle files inside <channel>/<fingerprint>/ are ever deleted.
    commands.push({
      label: 'prune',
      args: [
        ...base,
        '--delete',
        '--ignore-existing',
        ...layoutFilters({ bundles: true }),
        src,
        dest,
      ],
    });
  }
  return commands;
}

export function buildPullCommand({ from, to, sshCommand }) {
  return {
    label: 'pull',
    args: [
      '-a',
      '--exclude=.release.lock',
      '--delay-updates',
      ...(sshCommand ? ['-e', sshCommand] : []),
      ...layoutFilters({ bundles: true, names: ['history.json', 'manifest.json'] }),
      withTrailingSlash(from),
      withTrailingSlash(to),
    ],
  };
}

/** Pulls just manifest.json files (to compare sequences before pushing). */
export function buildManifestProbeCommand({ from, to, sshCommand }) {
  return {
    label: 'probe remote manifests',
    args: [
      '-a',
      ...(sshCommand ? ['-e', sshCommand] : []),
      ...layoutFilters({ names: ['manifest.json'] }),
      withTrailingSlash(from),
      withTrailingSlash(to),
    ],
  };
}

function runRsync(
  commands,
  { rsync = 'rsync', dryRun = false, run = spawnSync, log = console.log },
) {
  for (const { label, args } of commands) {
    log(`[ota-sync] rsync ${label}${dryRun ? ' (dry run)' : ''}`);
    if (dryRun) {
      log(`           ${rsync} ${args.join(' ')}`);
      continue;
    }
    const result = run(rsync, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw new Error(
        `rsync ${label} failed (${result.error?.message ?? `exit ${result.status}`}). ` +
          'The manifest is only transferred after the bundles, so devices still see the previous release.',
      );
    }
  }
}

function manifestSequence(root, channel, publicKeyPem) {
  const path = join(root, channel, 'manifest.json');
  if (!existsSync(path)) return 0;
  return verifyManifestEnvelope(JSON.parse(readFileSync(path, 'utf8')), publicKeyPem).sequence;
}

/**
 * A device refuses any manifest whose sequence is lower than one it has seen.
 * Pushing a stale workstation tree over a newer server tree would therefore
 * silently stop updates (and rollbacks) for every device that already saw the
 * newer manifest. Refuse, and tell the operator to pull first.
 */
export function assertDestinationNotNewer({ source, destination, publicKeyPem }) {
  for (const channel of CHANNELS) {
    const have = manifestSequence(source, channel, publicKeyPem);
    const there = manifestSequence(destination, channel, publicKeyPem);
    if (there > have) {
      throw new Error(
        `The destination's ${channel} manifest (sequence ${there}) is newer than this tree's (${have}). ` +
          'Someone released from another copy, or this tree is stale. Pull the server tree first ' +
          '(`ota:sync --from <server> --to <tree>`), redo the release on top of it, then push.',
      );
    }
  }
}

function copyAtomic(src, dest) {
  mkdirSync(join(dest, '..'), { recursive: true });
  const staging = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, staging);
  renameSync(staging, dest);
}

function listBundles(channelRoot) {
  const out = [];
  if (!existsSync(channelRoot)) return out;
  for (const entry of readdirSync(channelRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !FINGERPRINT_RE.test(entry.name)) continue;
    for (const file of readdirSync(join(channelRoot, entry.name))) {
      if (/^\d+\.bundle$/.test(file)) out.push(`${entry.name}/${file}`);
    }
  }
  return out;
}

function syncLocal({ from, to, publicKeyPem, prune, hooks }) {
  const summary = verifyReleaseTree(from, publicKeyPem);
  assertDestinationNotNewer({ source: from, destination: to, publicKeyPem });
  const copied = [];
  for (const channel of CHANNELS) {
    if (!summary[channel]) continue;
    const srcChannel = join(from, channel);
    const dstChannel = join(to, channel);

    // 1. immutable bundle files
    for (const name of listBundles(srcChannel)) {
      const src = join(srcChannel, name);
      const dst = join(dstChannel, name);
      if (existsSync(dst)) {
        if (sha256Hex(readFileSync(dst)) !== sha256Hex(readFileSync(src))) {
          throw new Error(
            `${channel}/${name} already exists at the destination with different content; ` +
              'bundle files are immutable. Refusing to continue.',
          );
        }
        continue;
      }
      copyAtomic(src, dst);
      copied.push(`${channel}/${name}`);
    }
  }

  hooks?.afterBundles?.();

  // Everything the new manifests reference must verify AT THE DESTINATION
  // before any manifest is replaced.
  for (const channel of CHANNELS) {
    if (!summary[channel]) continue;
    const manifest = JSON.parse(readFileSync(join(from, channel, 'manifest.json'), 'utf8'));
    const payload = JSON.parse(Buffer.from(manifest.payload, 'base64').toString('utf8'));
    for (const release of Object.values(payload.releases)) {
      verifyReleaseFile(to, channel, release, publicKeyPem);
    }
  }

  // 2 + 3. history, then the manifest (the activation step).
  for (const channel of CHANNELS) {
    if (!summary[channel]) continue;
    copyAtomic(join(from, channel, 'history.json'), join(to, channel, 'history.json'));
  }
  for (const channel of CHANNELS) {
    if (!summary[channel]) continue;
    copyAtomic(join(from, channel, 'manifest.json'), join(to, channel, 'manifest.json'));
  }

  // 4. pruning, only after activation.
  const pruned = [];
  if (prune) {
    for (const channel of CHANNELS) {
      if (!summary[channel]) continue;
      const keep = new Set(listBundles(join(from, channel)));
      for (const name of listBundles(join(to, channel))) {
        if (keep.has(name)) continue;
        rmSync(join(to, channel, name));
        pruned.push(`${channel}/${name}`);
      }
    }
  }

  verifyReleaseTree(to, publicKeyPem);
  return { copied, pruned };
}

/**
 * @param {object} o
 * @param {string} o.from      local directory or rsync spec
 * @param {string} o.to        local directory or rsync spec
 * @param {string} [o.publicKeyPem]  required unless pulling from a remote
 * @param {boolean} [o.prune]
 * @param {boolean} [o.dryRun]
 * @param {string} [o.sshCommand]
 * @param {boolean} [o.allowAnyRemotePath]  skip the "remote path ends in /bundles" guard
 */
export function syncTrees(o) {
  const { from, to, prune = true, dryRun = false } = o;
  const fromRemote = isRemoteSpec(from);
  const toRemote = isRemoteSpec(to);
  if (fromRemote && toRemote) throw new Error('Remote-to-remote sync is not supported.');
  if (fromRemote) assertBundlesDirectory(from, o);
  if (toRemote) assertBundlesDirectory(to, o);

  if (fromRemote) {
    runRsync([buildPullCommand({ from, to, sshCommand: o.sshCommand })], o);
    if (!dryRun && o.publicKeyPem) verifyReleaseTree(to, o.publicKeyPem);
    return { mode: 'pull' };
  }
  if (!o.publicKeyPem)
    throw new Error('A public key is required to verify the tree before pushing.');
  if (toRemote) {
    // Verify locally first; only a fully valid tree may leave this machine.
    verifyReleaseTree(from, o.publicKeyPem);
    // Fetch only the remote manifests (tiny) and refuse to push behind them.
    const probe = mkdtempSync(join(tmpdir(), 'erve-ota-probe-'));
    try {
      runRsync([buildManifestProbeCommand({ from: to, to: probe, sshCommand: o.sshCommand })], o);
      if (!dryRun) {
        assertDestinationNotNewer({
          source: from,
          destination: probe,
          publicKeyPem: o.publicKeyPem,
        });
      }
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
    runRsync(buildPushCommands({ from, to, prune, sshCommand: o.sshCommand }), o);
    return { mode: 'push' };
  }
  if (dryRun) {
    verifyReleaseTree(from, o.publicKeyPem);
    return { mode: 'local-dry-run' };
  }
  return {
    mode: 'local',
    ...syncLocal({ from, to, publicKeyPem: o.publicKeyPem, prune, hooks: o.hooks }),
  };
}
