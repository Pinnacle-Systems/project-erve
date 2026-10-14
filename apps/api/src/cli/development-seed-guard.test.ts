import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
describe('generic development seed safety', () => {
  it('refuses production before attempting any database connection', async () => {
    const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
    const output = await new Promise<{ code: number | null; text: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx/esm', path.join(apiRoot, 'prisma/seed.ts')],
        {
          cwd: apiRoot,
          windowsHide: true,
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL:
              'postgresql://unreachable:seed-test-secret@127.0.0.1:1/erve_seed_guard_test',
            FILE_STORAGE_DIR: path.join(os.tmpdir(), 'seed-guard-unused'),
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
    });
    expect(output.code).not.toBe(0);
    expect(output.text).toContain('Generic development seed refuses production');
    expect(output.text).not.toContain('seed-test-secret');
    expect(output.text).not.toContain('ECONNREFUSED');
  }, 20000);
});
