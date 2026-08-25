// Process-level tests for the quality-bootstrap CLI entrypoint — mirrors
// roles-bootstrap.cli.test.ts's approach (spawn the real tsx-run CLI
// against the same local test database used by the rest of the API test
// suite).
import { describe, expect, it, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';

const API_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const CLI_ENTRY = path.join(API_ROOT, 'src', 'cli', 'quality-bootstrap.cli.ts');

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(envOverrides: Record<string, string | undefined>, args: string[] = []): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', CLI_ENTRY, ...args], {
      cwd: API_ROOT,
      env: { ...process.env, ...envOverrides },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

beforeEach(async () => {
  await resetDatabase();
});

describe('quality-bootstrap CLI', () => {
  it('installs everything on an empty database and reports it', async () => {
    const result = await runCli({ NODE_ENV: 'test' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SAMPLE');
    expect(result.stdout).toContain('PPM');
    expect(result.stdout).toContain('INLINE');
    expect(result.stdout).toContain('FINAL');
    expect(result.stdout).toContain('ERVE_PRODUCTION_QUALITY');
    expect(result.stdout).toContain('INLINE -> SEWING');
    expect(result.stdout).toContain('FINAL -> FINISHING');
    expect(result.stdout).toContain('FINAL multiplicity -> BATCHED');
    expect(result.stdout).toContain('FINAL coverage -> PREPARED_QUANTITY');
    expect(result.stdout).toContain('Production percentage completion configuration: NONE');
    expect(result.stdout).toContain('Bootstrap completed successfully');

    await expect(prisma.qualityForm.count()).resolves.toBe(4);
    await expect(prisma.processFlow.count({ where: { code: 'ERVE_PRODUCTION_QUALITY' } })).resolves.toBe(1);
  }, 30000);

  it('requires --confirm-production in production mode and touches nothing', async () => {
    const result = await runCli({ NODE_ENV: 'production' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--confirm-production');
    await expect(prisma.qualityForm.count()).resolves.toBe(0);
  }, 30000);

  it('--dry-run writes nothing', async () => {
    const result = await runCli({ NODE_ENV: 'test' }, ['--dry-run']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('dry run');
    await expect(prisma.qualityForm.count()).resolves.toBe(0);
    await expect(prisma.processFlow.count()).resolves.toBe(0);
  }, 30000);
});
