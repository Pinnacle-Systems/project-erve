import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { assertExternalArtifactRoot } from './artifact-safety.mjs';
test('refuses repo descendants and ancestors before creating any output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pr8-artifact-guard-'));
  const repo = join(root, 'repo');
  await mkdir(repo);
  try {
    await assert.rejects(assertExternalArtifactRoot(join(repo, 'credentials'), [repo]));
    await assert.rejects(assertExternalArtifactRoot(root, [repo]));
    assert.equal(
      await assertExternalArtifactRoot(join(root, 'external', 'run'), [repo]),
      join(root, 'external', 'run'),
    );
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true });
  }
});
test('refuses existing links resolving into protected repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pr8-artifact-link-'));
  const repo = join(root, 'repo');
  await mkdir(repo);
  try {
    const link = join(root, 'alias');
    await symlink(repo, link, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(assertExternalArtifactRoot(join(link, 'run'), [repo]));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true });
  }
});
