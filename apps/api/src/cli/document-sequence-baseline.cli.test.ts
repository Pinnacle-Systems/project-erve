import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { ensureFinancialYear } from '../modules/master-data/financial-year.service.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, '../../../../');
const apiRoot = path.resolve(monorepoRoot, 'apps/api');
const bundledBaselineCli = path.resolve(apiRoot, 'dist-bundle/document-sequence-baseline.js');
const bundledPreflightCli = path.resolve(apiRoot, 'dist-bundle/ei-numbering-preflight.js');

function ensureBundlesExist(): void {
  if (!fs.existsSync(bundledBaselineCli) || !fs.existsSync(bundledPreflightCli)) {
    execFileSync(process.execPath, [path.resolve(apiRoot, 'esbuild.config.mjs')], {
      cwd: apiRoot,
      stdio: 'pipe',
    });
  }
}

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/erve_test?schema=public';
const testDatabaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] || 'erve_test';
  } catch {
    return 'erve_test';
  }
})();

beforeAll(() => {
  ensureBundlesExist();
});

afterAll(() => prisma.$disconnect());

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

describe('Packaged CLI Process Invariants', () => {
  it('document-sequence-baseline.js --help runs under plain Node without database or env dependencies', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundledBaselineCli, '--help'], {
      env: {}, // Completely empty environment
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('ERVE India — Document Sequence Baseline CLI');
    expect(stdout).toContain('--target');
    expect(stdout).toContain('--document-type');
    expect(stdout).toContain('--financial-year');
    expect(stdout).toContain('--serial');
    expect(stdout).toContain('--expect-schema');
    expect(stdout).toContain('--env-file');
    expect(stdout).toContain('--confirm-production');
  });

  it('ei-numbering-preflight.js --help runs under plain Node without database or env dependencies', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [bundledPreflightCli, '--help'], {
      env: {}, // Completely empty environment
    });

    expect(stderr).toBe('');
    expect(stdout).toContain('ERVE India — EI Numbering Cutover Preflight Diagnostic CLI');
    expect(stdout).toContain('--target');
    expect(stdout).toContain('--financial-year');
    expect(stdout).toContain('--expect-database');
    expect(stdout).toContain('--env-file');
  });

  it('baseline CLI rejects execution when --target is missing', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [bundledBaselineCli, '--document-type', 'TAX_INVOICE', '--financial-year', '2026-27', '--serial', '100'],
        {
          env: {
            ...process.env,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/--target is required/);
  });

  it('baseline CLI rejects execution against production target without --confirm-production', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'production',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2026-27',
          '--serial',
          '100',
          '--expect-database',
          testDatabaseName,
          '--expect-schema',
          'public',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/Production execution requires explicit confirmation via --confirm-production/);
  });

  it('baseline CLI rejects production mutation when NODE_ENV is unset or non-production', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'production',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2026-27',
          '--serial',
          '100',
          '--expect-database',
          testDatabaseName,
          '--expect-schema',
          'public',
          '--confirm-production',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/Production mutation requires explicit NODE_ENV="production"/);
  });

  it('baseline CLI rejects production mutation when --expect-schema is missing', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'production',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2026-27',
          '--serial',
          '100',
          '--expect-database',
          testDatabaseName,
          '--confirm-production',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/Production mutation requires --expect-schema <schema>/);
  });

  it('baseline CLI rejects conflicting target when NODE_ENV is production but target is local', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'local',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2026-27',
          '--serial',
          '100',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/Conflicting environment configuration.*Production environments cannot be targeted as non-production/);
  });

  it('baseline CLI rejects database target mismatch when connected database does not match --expect-database', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'test',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2026-27',
          '--serial',
          '100',
          '--expect-database',
          'wrong_database_name',
        ],
        {
          env: {
            ...process.env,
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(
      new RegExp(`Database identity mismatch: live current_database\\(\\) is "${testDatabaseName}", but --expect-database specified "wrong_database_name"`),
    );
  });

  it('preflight CLI rejects production target without --expect-database', async () => {
    let err: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [
          bundledPreflightCli,
          '--target',
          'production',
          '--financial-year',
          '2026-27',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            DATABASE_URL: testDatabaseUrl,
          },
        },
      );
    } catch (e: unknown) {
      err = e as ExecError;
    }

    expect(err).toBeDefined();
    expect(err?.code).not.toBe(0);
    expect(err?.stderr || err?.stdout).toMatch(/Production target requires --expect-database <name>/);
  });

  it('baseline CLI runs with --dry-run and full production guards without applying sequence mutations', async () => {
    // Ensure isolated FY exists in the test database
    await ensureFinancialYear(prisma, new Date('2038-06-01'));

    const testDb = testDatabaseUrl;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bundledBaselineCli,
        '--target',
        'production',
        '--document-type',
        'TAX_INVOICE',
        '--financial-year',
        '2038-39',
        '--serial',
        '0',
        '--expect-database',
        testDatabaseName,
        '--expect-schema',
        'public',
        '--confirm-production',
        '--dry-run',
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_URL: testDb,
        },
      },
    );

    expect(stdout).toContain('[DRY RUN] Verification passed. Transaction rolled back; zero persistent mutations performed.');
    expect(stdout).toContain('Target Environment:      PRODUCTION');
    expect(stdout).toContain(`Database Name:           ${testDatabaseName}`);
    expect(stdout).toContain('Database Schema:         public');
    expect(stdout).toContain('Would initialize TAX_INVOICE sequence for FY 2038-39 at 0 (next allocated serial will be 1)');
  });

  it('baseline CLI loads runtime environment when invoked from outside the API directory via adjacent .env', async () => {
    const testDb = testDatabaseUrl;
    const adjacentEnv = path.resolve(path.dirname(bundledBaselineCli), '.env');

    // Create .env adjacent to the bundled CLI script
    fs.writeFileSync(
      adjacentEnv,
      `DATABASE_URL="${testDb}"\nNODE_ENV="test"\nJWT_ACCESS_SECRET="ci-only-access-secret-32-chars-long"\nJWT_REFRESH_SECRET="ci-only-refresh-secret-32-chars-long"\n`,
    );

    // Run from another unrelated directory (system temp root) so CWD has NO .env
    const outsideCwd = os.tmpdir();

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'test',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2038-39',
          '--serial',
          '0',
          '--expect-database',
          testDatabaseName,
          '--dry-run',
        ],
        {
          cwd: outsideCwd,
          env: {
            // Deliberately do NOT pass DATABASE_URL in process.env — force loading from script-adjacent .env
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
          },
        },
      );

      expect(stdout).toContain('[DRY RUN] Verification passed.');
      expect(stdout).toContain(`Database Name:           ${testDatabaseName}`);
    } finally {
      if (fs.existsSync(adjacentEnv)) {
        fs.unlinkSync(adjacentEnv);
      }
    }
  });

  it('baseline CLI loads runtime environment from explicit --env-file flag', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erve-explicit-env-'));
    const testDb = testDatabaseUrl;
    const explicitEnvPath = path.join(tempDir, 'custom.env');
    fs.writeFileSync(
      explicitEnvPath,
      `DATABASE_URL="${testDb}"\nNODE_ENV="test"\nJWT_ACCESS_SECRET="ci-only-access-secret-32-chars-long"\nJWT_REFRESH_SECRET="ci-only-refresh-secret-32-chars-long"\n`,
    );

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          bundledBaselineCli,
          '--target',
          'test',
          '--document-type',
          'TAX_INVOICE',
          '--financial-year',
          '2038-39',
          '--serial',
          '0',
          '--expect-database',
          testDatabaseName,
          '--env-file',
          explicitEnvPath,
          '--dry-run',
        ],
        {
          cwd: os.tmpdir(),
          env: {
            PATH: process.env.PATH,
            SYSTEMROOT: process.env.SYSTEMROOT,
          },
        },
      );

      expect(stdout).toContain('[DRY RUN] Verification passed.');
      expect(stdout).toContain(`Database Name:           ${testDatabaseName}`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
