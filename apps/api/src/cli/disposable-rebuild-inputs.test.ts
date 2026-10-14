import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadRebuildInputs } from './disposable-rebuild-inputs.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
describe('sealed rebuild inputs', () => {
  it('verifies manifest and every selected file before any database mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rebuild-inputs-'));
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected cleanup path');
    try {
      await mkdir(path.join(root, 'generated'));
      const names = ['seasons', 'sizes', 'factories', 'distributors', 'retailStores', 'styles'];
      const files = Object.fromEntries(names.map((name) => [name, `generated/${name}.csv`]));
      for (const file of Object.values(files))
        await writeFile(path.join(root, file), 'Name\nRecord\n');
      const manifest = JSON.stringify({
        outputs: Object.values(files).map((file) => ({ file, sha256: hash('Name\nRecord\n') })),
      });
      await writeFile(path.join(root, 'manifest.json'), manifest);
      const config = {
        sourceRoot: root,
        manifestFile: 'manifest.json',
        manifestSha256: hash(manifest),
        files,
      };
      const loaded = await loadRebuildInputs(config);
      expect(loaded.files.factories.buffer.toString()).toBe('Name\nRecord\n');
      await writeFile(path.join(root, files.factories!), 'changed');
      await expect(loadRebuildInputs(config)).rejects.toThrow('checksum');
      await expect(
        loadRebuildInputs({ ...config, manifestSha256: '0'.repeat(64) }),
      ).rejects.toThrow('Manifest checksum');
      await expect(
        loadRebuildInputs({ ...config, files: { ...files, styles: '../outside.xlsx' } }),
      ).rejects.toThrow('outside');
    } finally {
      await rm(root, { recursive: true });
    }
  });
});
