import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('actual rebuild CLI refusal before connecting or writing', () => {
  it.each([
    {
      nodeEnv: 'production',
      name: 'erve_rebuild_cli_test',
      confirm: true,
      message: 'refuses production',
    },
    { nodeEnv: 'test', name: 'erve_prod', confirm: true, message: 'does not match' },
    { nodeEnv: 'test', name: 'erve_rebuild_cli_test', confirm: false, message: '--confirm-write' },
  ])(
    '$message',
    async ({ nodeEnv, name, confirm, message }) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'rebuild-cli-test-'));
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
        throw new Error('Unexpected cleanup target');
      const id = 'b'.repeat(32);
      const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
      try {
        const configFile = path.join(directory, 'config.json');
        await writeFile(
          configFile,
          JSON.stringify({
            disposableId: id,
            databaseName: 'erve_rebuild_cli_test',
            expectedServerAddress: '127.0.0.1/32',
            sourceRoot: path.join(directory, 'source'),
            reportRoot: path.join(directory, `rebuild-${id}`),
            mediaRoot: path.join(directory, `media-${id}`),
            manifestFile: 'manifest.json',
            manifestSha256: '0'.repeat(64),
            files: {
              seasons: 's.csv',
              sizes: 'z.csv',
              factories: 'f.csv',
              distributors: 'd.csv',
              retailStores: 'r.csv',
              styles: 'styles.xlsx',
            },
            adminEmail: 'disposable@example.invalid',
            adminName: 'Disposable',
            styleWorksheet: 'Styles',
          }),
        );
        const output = await new Promise<{ code: number | null; text: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '--import',
                'tsx/esm',
                path.join(apiRoot, 'src/cli/disposable-rebuild.cli.ts'),
                '--config',
                configFile,
                '--execute',
                ...(confirm ? ['--confirm-write'] : []),
              ],
              {
                cwd: apiRoot,
                windowsHide: true,
                env: {
                  ...process.env,
                  NODE_ENV: nodeEnv,
                  DATABASE_URL: `postgresql://unreachable:cli-test-secret@127.0.0.1:1/${name}`,
                  FILE_STORAGE_DIR: path.join(directory, `media-${id}`),
                  JWT_ACCESS_SECRET: 'a'.repeat(64),
                  JWT_REFRESH_SECRET: 'b'.repeat(64),
                },
              },
            );
            let text = '';
            child.stdout.on('data', (bytes) => {
              text += String(bytes);
            });
            child.stderr.on('data', (bytes) => {
              text += String(bytes);
            });
            child.on('error', reject);
            child.on('close', (code) => resolve({ code, text }));
          },
        );
        expect(output.code).toBe(1);
        expect(output.text).toContain(message);
        expect(output.text).not.toContain('cli-test-secret');
        expect(output.text).not.toContain('ECONNREFUSED');
      } finally {
        await rm(directory, { recursive: true });
      }
    },
    30000,
  );
});
