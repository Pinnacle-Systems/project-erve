/**
 * Repository-level release policy for OTA:
 *  - nothing may publish, promote, roll back or sync OTA releases automatically
 *    (in particular never because code was pushed to main);
 *  - application deployments never touch the OTA release directory;
 *  - no signing key can be committed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const workflowsDir = join(repoRoot, '.github', 'workflows');
const workflows = readdirSync(workflowsDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => ({ file, text: readFileSync(join(workflowsDir, file), 'utf8') }));

const OTA_RELEASE_COMMAND =
  /ota-release\.mjs|ota:(?:publish|promote|rollback|retire|sync)|ota-sync|mobile-updates\/bundles/;

/** Names of the triggers under a workflow's top-level `on:` key. */
function triggersOf(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^on:/.test(line));
  if (start < 0) return [];
  const triggers: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break; // next top-level key
    const match = /^ {2}([a-z_]+):/.exec(line);
    if (match) triggers.push(match[1]!);
  }
  return triggers;
}

describe('OTA release policy', () => {
  it('finds the workflows it is meant to police', () => {
    expect(workflows.map((w) => w.file)).toContain('ci.yml');
    expect(triggersOf(workflows.find((w) => w.file === 'ci.yml')!.text)).toContain('push');
    expect(triggersOf(workflows.find((w) => w.file === 'deploy-production.yml')!.text)).toEqual([
      'workflow_dispatch',
    ]);
  });

  it('no workflow that triggers on push or pull_request runs an OTA release command', () => {
    for (const { file, text } of workflows) {
      const triggers = triggersOf(text);
      const automatic = triggers.some((t) => t !== 'workflow_dispatch');
      if (!automatic) continue;
      const releaseLines = text
        .split('\n')
        .filter((line) => OTA_RELEASE_COMMAND.test(line) && !/^\s*#/.test(line));
      expect(releaseLines, `${file} must not publish OTA releases automatically`).toEqual([]);
    }
  });

  it('any workflow that does release OTA is manual-only (workflow_dispatch)', () => {
    for (const { file, text } of workflows) {
      const touchesRelease = text
        .split('\n')
        .some((line) => OTA_RELEASE_COMMAND.test(line) && !/^\s*#/.test(line));
      if (touchesRelease) {
        expect(triggersOf(text), `${file} must be workflow_dispatch only`).toEqual([
          'workflow_dispatch',
        ]);
      }
    }
  });

  it('application deployment scripts never write to the OTA release directory', () => {
    const dir = join(repoRoot, 'scripts', 'deployment');
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!/\.(sh|mjs)$/.test(file)) continue;
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      for (const line of lines) {
        if (!line.includes('mobile-updates') || /^\s*#/.test(line)) continue;
        // creating the empty directory on first deploy is the only allowed touch
        if (/^\s*mkdir -p /.test(line)) continue;
        offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the public key may be committed under apps/mobile/ota, and signing keys are git-ignored', () => {
    const otaDir = join(repoRoot, 'apps', 'mobile', 'ota');
    if (existsSync(otaDir)) {
      for (const file of readdirSync(otaDir)) {
        const text = readFileSync(join(otaDir, file), 'utf8');
        expect(text, `${file} must not contain a private key`).not.toMatch(/PRIVATE KEY/);
      }
    }
    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/ota-private/);
    expect(ignore).toMatch(/\*\.pem/);
  });
});
