// Process-level tests for the actual CLI entrypoint (argv parsing, exit
// codes, and — critically — that nothing prints the plaintext password).
// The pure-logic tests live in admin-bootstrap.test.ts; these spawn the
// real tsx-run CLI as a child process against the same local test database
// used by the rest of the API test suite.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db/prisma.js';

const API_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const CLI_ENTRY = path.join(API_ROOT, 'src', 'cli', 'admin-bootstrap.cli.ts');

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Runs the CLI the same way `tsx <file>` does under the hood
// (Node's --import loader hook), rather than spawning the tsx shell/CMD
// wrapper directly — avoids Windows .CMD-vs-child_process quirks and works
// identically cross-platform.
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

const testEmails: string[] = [];

afterEach(async () => {
  if (testEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
    testEmails.length = 0;
  }
});

describe('admin-bootstrap CLI', () => {
  it('exits non-zero when required input is missing', async () => {
    const result = await runCli({ ADMIN_EMAIL: undefined, ADMIN_NAME: undefined, NODE_ENV: 'test' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('ADMIN_EMAIL and ADMIN_NAME');
  }, 20000);

  it('creates the admin, reports success, and never prints the plaintext password', async () => {
    const email = 'cli-created@example.test';
    testEmails.push(email);
    const secret = 'cli-secret-password-1';

    const result = await runCli({
      ADMIN_EMAIL: email,
      ADMIN_NAME: 'CLI Created Admin',
      ADMIN_PASSWORD: secret,
      NODE_ENV: 'test',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('created');
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toContain(secret);
  }, 20000);

  it('is idempotent end-to-end through the CLI and reads ADMIN_PASSWORD_FILE without echoing it', async () => {
    const email = 'cli-file-password@example.test';
    testEmails.push(email);
    const secret = 'cli-file-secret-password-1';

    const dir = await mkdtemp(path.join(tmpdir(), 'erve-admin-bootstrap-'));
    const passwordFile = path.join(dir, 'password.txt');
    await writeFile(passwordFile, `${secret}\n`, 'utf8');

    try {
      const first = await runCli({
        ADMIN_EMAIL: email,
        ADMIN_NAME: 'CLI File Admin',
        ADMIN_PASSWORD_FILE: passwordFile,
        ADMIN_PASSWORD: undefined,
        NODE_ENV: 'test',
      });
      expect(first.code).toBe(0);
      expect(first.stdout).toContain('created');
      expect(first.stdout).not.toContain(secret);

      const second = await runCli({
        ADMIN_EMAIL: email,
        ADMIN_NAME: 'CLI File Admin',
        ADMIN_PASSWORD_FILE: passwordFile,
        ADMIN_PASSWORD: undefined,
        NODE_ENV: 'test',
      });
      expect(second.code).toBe(0);
      expect(second.stdout).toContain('already configured');
      expect(second.stdout).not.toContain(secret);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);

  it('requires --confirm-production in production mode', async () => {
    const email = 'cli-prod-guard@example.test';

    const result = await runCli({
      ADMIN_EMAIL: email,
      ADMIN_NAME: 'CLI Prod Guard',
      ADMIN_PASSWORD: 'irrelevant-password1',
      NODE_ENV: 'production',
    });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--confirm-production');

    await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull();
  }, 20000);
});
