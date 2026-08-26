// Process-level tests for the financial-year-bootstrap CLI entrypoint —
// mirrors roles-bootstrap.cli.test.ts's approach (spawn the real tsx-run
// CLI against the same local test database used by the rest of the API
// test suite).
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db/prisma.js';
import { computeFinancialYearWindow, toBusinessCalendarDate } from '../modules/master-data/financial-year.util.js';

const API_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const CLI_ENTRY = path.join(API_ROOT, 'src', 'cli', 'financial-year-bootstrap.cli.ts');

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

describe('financial-year-bootstrap CLI', () => {
  it('ensures the rolling Financial Year window and reports it', async () => {
    const result = await runCli({ NODE_ENV: 'test' });

    expect(result.code).toBe(0);
    const currentCode = computeFinancialYearWindow(toBusinessCalendarDate(new Date())).code;
    expect(result.stdout).toContain(currentCode);

    const financialYears = await prisma.financialYear.findMany();
    expect(financialYears.length).toBeGreaterThanOrEqual(9);
  }, 20000);

  it('requires --confirm-production in production mode', async () => {
    const result = await runCli({ NODE_ENV: 'production' });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--confirm-production');
  }, 20000);
});
