// Process-level tests for the roles-bootstrap CLI entrypoint — mirrors
// admin-bootstrap.cli.test.ts's approach (spawn the real tsx-run CLI
// against the same local test database used by the rest of the API test
// suite).
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES } from '@erve/types';
import { prisma } from '../db/prisma.js';

const API_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const CLI_ENTRY = path.join(API_ROOT, 'src', 'cli', 'roles-bootstrap.cli.ts');

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

describe('roles-bootstrap CLI', () => {
  it('ensures every role and reports them', async () => {
    const result = await runCli({ NODE_ENV: 'test' });

    expect(result.code).toBe(0);
    for (const role of ROLES) {
      expect(result.stdout).toContain(role);
    }

    const roles = await prisma.role.findMany({ where: { name: { in: [...ROLES] } } });
    expect(roles.map((r) => r.name).sort()).toEqual([...ROLES].sort());
  }, 20000);

  it('requires --confirm-production in production mode', async () => {
    const result = await runCli({ NODE_ENV: 'production' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--confirm-production');
  }, 20000);
});
