import { describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  validateRebuildSafety,
  assertRebuildPaths,
  claimRebuildDirectory,
} from './disposable-rebuild-safety.js';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';

const id = 'a'.repeat(32);
const config = {
  disposableId: id,
  databaseName: 'erve_rebuild_acceptance_test',
  expectedServerAddress: '10.89.0.2/32',
  sourceRoot: path.join(os.tmpdir(), 'rebuild-sources'),
  reportRoot: path.join(os.tmpdir(), `rebuild-${id}`),
  mediaRoot: path.join(os.tmpdir(), `media-${id}`),
};
const url = 'postgresql://example:secret@127.0.0.1:5432/erve_rebuild_acceptance_test';
describe('disposable rebuild safety before writes', () => {
  it('refuses descendant junctions in an owned media root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rebuild-link-test-'));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected fixture path');
    try {
      const media = path.join(root, 'media');
      const external = path.join(root, 'external');
      await mkdir(media);
      await mkdir(external);
      await symlink(external, path.join(media, 'style-images'), 'junction');
      await expect(
        assertRebuildPaths({
          ...config,
          sourceRoot: path.join(root, 'source'),
          reportRoot: path.join(root, 'report'),
          mediaRoot: media,
        }),
      ).rejects.toThrow(/link|junction/i);
    } finally {
      await rm(root, { recursive: true });
    }
  });
  it('allows only one owner when different databases race to claim the same directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rebuild-owner-race-'));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected fixture path');
    try {
      const results = await Promise.allSettled([
        claimRebuildDirectory(root, 'database-one'),
        claimRebuildDirectory(root, 'database-two'),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true });
    }
  });
  it('accepts an explicit isolated target and distinct external roots', () => {
    expect(
      validateRebuildSafety(config, {
        databaseUrl: url,
        nodeEnv: 'test',
        repositoryRoot: process.cwd(),
        execute: true,
        confirmWrite: true,
      }).databaseName,
    ).toBe(config.databaseName);
  });
  it.each([
    {
      databaseUrl: url.replace('127.0.0.1', 'production.example'),
      nodeEnv: 'test',
      confirmWrite: true,
    },
    {
      databaseUrl: url.replace('erve_rebuild_acceptance_test', 'erve_prod'),
      nodeEnv: 'test',
      confirmWrite: true,
    },
    { databaseUrl: url, nodeEnv: 'production', confirmWrite: true },
    { databaseUrl: url, nodeEnv: 'test', confirmWrite: false },
    { databaseUrl: url, nodeEnv: 'test', confirmWrite: true, developmentDatabaseUrl: url },
    {
      databaseUrl: url,
      nodeEnv: 'test',
      confirmWrite: true,
      developmentDatabaseUrl: url.replace('127.0.0.1:5432', 'localhost'),
    },
  ])('refuses unsafe target options %j', (options) => {
    expect(() =>
      validateRebuildSafety(config, { repositoryRoot: process.cwd(), execute: true, ...options }),
    ).toThrow();
  });
  it('refuses storage inside source/repository or an unowned directory', () => {
    for (const mediaRoot of [
      config.sourceRoot,
      process.cwd(),
      path.join(os.tmpdir(), 'existing-media'),
    ])
      expect(() =>
        validateRebuildSafety(
          { ...config, mediaRoot },
          {
            databaseUrl: url,
            nodeEnv: 'test',
            repositoryRoot: process.cwd(),
            execute: false,
            confirmWrite: false,
          },
        ),
      ).toThrow();
  });
  it('permits read-only planning without write confirmation', () => {
    expect(
      validateRebuildSafety(config, {
        databaseUrl: url,
        nodeEnv: 'test',
        repositoryRoot: process.cwd(),
        execute: false,
        confirmWrite: false,
      }),
    ).toBeTruthy();
  });
});
