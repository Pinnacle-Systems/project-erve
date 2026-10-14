import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { ensureFinancialYear } from '../modules/master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../modules/master-data/document-sequence.service.js';
import { DOCUMENT_PREFIXES, formatDocumentNumber } from '../modules/master-data/document-number.util.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const monorepoRoot = path.resolve(__dirname, '../../../../');
const apiRoot = path.resolve(monorepoRoot, 'apps/api');

// Dynamically resolve executable paths: prefer extracted release artifact if available,
// falling back to dist-bundle.
const extractedApiDir = process.env.EXTRACTED_ARTIFACT_DIR ||
  path.resolve(monorepoRoot, '.deploy-build/verify-extract/api');
const hasExtractedArtifact = fs.existsSync(path.resolve(extractedApiDir, 'document-sequence-baseline.js'));

const bundledBaselineCli = hasExtractedArtifact
  ? path.resolve(extractedApiDir, 'document-sequence-baseline.js')
  : path.resolve(apiRoot, 'dist-bundle/document-sequence-baseline.js');

const bundledPreflightCli = hasExtractedArtifact
  ? path.resolve(extractedApiDir, 'ei-numbering-preflight.js')
  : path.resolve(apiRoot, 'dist-bundle/ei-numbering-preflight.js');

function ensureBundlesExist(): void {
  if (hasExtractedArtifact) return;
  if (!fs.existsSync(bundledBaselineCli) || !fs.existsSync(bundledPreflightCli)) {
    execFileSync(process.execPath, [path.resolve(apiRoot, 'esbuild.config.mjs')], {
      cwd: apiRoot,
      stdio: 'pipe',
    });
  }
}

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/erve_test?schema=public';

const testDatabaseName = (() => {
  try {
    return new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '').split('?')[0] || 'erve_test';
  } catch {
    return 'erve_test';
  }
})();

interface ExecError extends Error {
  code?: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Reviewer Finding 4: Strict test database isolation guard.
 * Validates that database URLs point to an approved disposable test database
 * and refuses execution against any production, staging, or non-test databases.
 */
function assertDisposableTestDatabase(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[DB Guard] ${label} is not a valid URL: ${url}`);
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
  const FORBIDDEN_DATABASES = ['erve_prod', 'erve_production', 'erve_staging', 'erve_docs', 'erve_dev'];
  if (FORBIDDEN_DATABASES.includes(dbName)) {
    throw new Error(
      `[DB Guard] Refusing rehearsal writes: ${label} points to protected database "${dbName}". ` +
        'Rehearsal tests must only run against an approved disposable test database.',
    );
  }
  if (!dbName.endsWith('_test') && dbName !== 'erve_test') {
    throw new Error(
      `[DB Guard] Refusing rehearsal writes: ${label} database "${dbName}" must end with "_test" or be "erve_test".`,
    );
  }
  return `${parsed.hostname}:${parsed.port || '5432'}/${dbName}`;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Packaged Artifact Rehearsal (RST-002 Section 4)', () => {
  const rehearsalFyCode = '2036-37';
  let rehearsalFyId: string;

  beforeAll(async () => {
    ensureBundlesExist();

    // Reviewer Finding 4: Assert both TEST_DATABASE_URL and process.env.DATABASE_URL
    // resolve to the same approved disposable test database BEFORE any writes.
    const testEndpoint = assertDisposableTestDatabase(TEST_DATABASE_URL, 'TEST_DATABASE_URL');
    const parentEndpoint = assertDisposableTestDatabase(
      process.env.DATABASE_URL || TEST_DATABASE_URL,
      'DATABASE_URL',
    );

    if (testEndpoint !== parentEndpoint) {
      throw new Error(
        `[DB Guard] Endpoint mismatch: TEST_DATABASE_URL points to "${testEndpoint}" ` +
          `while DATABASE_URL points to "${parentEndpoint}". Both must resolve to the identical disposable test database.`,
      );
    }

    // Force synchronization to guarantee Prisma connects to the verified test DB
    process.env.DATABASE_URL = TEST_DATABASE_URL;

    // Verify live connected database directly over Prisma connection
    const [liveRow] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() as db`;
    if (!liveRow?.db || (!liveRow.db.toLowerCase().endsWith('_test') && liveRow.db.toLowerCase() !== 'erve_test')) {
      throw new Error(
        `[DB Guard] Live current_database() "${liveRow?.db}" is not an approved test database. Aborting rehearsal.`,
      );
    }

    // 3. Financial-year availability: Ensure dedicated test FY exists for rehearsal
    const fy = await ensureFinancialYear(prisma, new Date('2036-06-01'));
    rehearsalFyId = fy.id;

    // Clean any prior rehearsal sequence rows for isolation
    await prisma.documentSequence.deleteMany({
      where: { financialYearId: rehearsalFyId },
    });
  });

  it('1. Artifact extraction and executable availability', () => {
    expect(fs.existsSync(bundledBaselineCli)).toBe(true);
    expect(fs.existsSync(bundledPreflightCli)).toBe(true);
    expect(fs.statSync(bundledBaselineCli).size).toBeGreaterThan(100_000);
    expect(fs.statSync(bundledPreflightCli).size).toBeGreaterThan(100_000);
  });

  it('2. Environment and database-target guard behavior', async () => {
    // Rejects missing target
    let errNoTarget: ExecError | undefined;
    try {
      await execFileAsync(
        process.execPath,
        [bundledBaselineCli, '--document-type', 'TAX_INVOICE', '--financial-year', rehearsalFyCode, '--serial', '0'],
        { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
      );
    } catch (e: unknown) {
      errNoTarget = e as ExecError;
    }
    expect(errNoTarget?.code).not.toBe(0);
    expect(errNoTarget?.stderr || errNoTarget?.stdout).toContain('--target is required');

    // Rejects database identity mismatch
    let errDbMismatch: ExecError | undefined;
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
          rehearsalFyCode,
          '--serial',
          '0',
          '--expect-database',
          'wrong_db_name',
        ],
        { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
      );
    } catch (e: unknown) {
      errDbMismatch = e as ExecError;
    }
    expect(errDbMismatch?.code).not.toBe(0);
    expect(errDbMismatch?.stderr || errDbMismatch?.stdout).toContain(
      `Database identity mismatch: live current_database() is "${testDatabaseName}", but --expect-database specified "wrong_db_name"`,
    );

    // Rejects production target without explicit confirmation
    let errNoConfirm: ExecError | undefined;
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
          rehearsalFyCode,
          '--serial',
          '0',
          '--expect-database',
          testDatabaseName,
          '--expect-schema',
          'public',
        ],
        { env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: TEST_DATABASE_URL } },
      );
    } catch (e: unknown) {
      errNoConfirm = e as ExecError;
    }
    expect(errNoConfirm?.code).not.toBe(0);
    expect(errNoConfirm?.stderr || errNoConfirm?.stdout).toContain(
      'Production execution requires explicit confirmation via --confirm-production',
    );
  });

  it('3. Financial-year availability guard fails safely on missing FY', async () => {
    let errMissingFy: ExecError | undefined;
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
          '2099-00', // Non-existent FY
          '--serial',
          '0',
          '--expect-database',
          testDatabaseName,
        ],
        { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
      );
    } catch (e: unknown) {
      errMissingFy = e as ExecError;
    }
    expect(errMissingFy?.code).not.toBe(0);
    expect(errMissingFy?.stderr || errMissingFy?.stdout).toContain('Financial Year 2099-00 not found');
  });

  it('4. Missing-row baseline initialization with baseline 0', async () => {
    // Assert row does not exist before execution
    const seqBefore = await prisma.documentSequence.findUnique({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seqBefore).toBeNull();

    // Execute packaged CLI
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bundledBaselineCli,
        '--target',
        'test',
        '--document-type',
        'TAX_INVOICE',
        '--financial-year',
        rehearsalFyCode,
        '--serial',
        '0',
        '--expect-database',
        testDatabaseName,
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
    );

    expect(stdout).toContain('Action:                  INITIALIZE sequence at 0');
    expect(stdout).toContain('initialized: TAX_INVOICE sequence for FY 2036-37 at 0 (next allocated serial will be 1)');

    // Verify row was created in database with serial 0
    const seqAfter = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seqAfter.lastAllocatedSerial).toBe(0);
  });

  it('5. Expected next Tax Invoice serial after baseline 0 is 1', async () => {
    const allocatedSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'TAX_INVOICE', rehearsalFyId),
    );
    expect(allocatedSerial).toBe(1);

    const invoiceNumber = formatDocumentNumber(DOCUMENT_PREFIXES.TAX_INVOICE, rehearsalFyCode, allocatedSerial);
    expect(invoiceNumber).toBe('EI/36-37/0001');
  });

  it('6. Re-running the same baseline without unexpected mutation is idempotent', async () => {
    // Current serial is 1 after allocation in step 5.
    // Setting baseline to 1 represents the same high-water mark.
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bundledBaselineCli,
        '--target',
        'test',
        '--document-type',
        'TAX_INVOICE',
        '--financial-year',
        rehearsalFyCode,
        '--serial',
        '1',
        '--expect-database',
        testDatabaseName,
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
    );

    expect(stdout).toContain('Action:                  NO-OP (sequence is already at baseline 1)');
    expect(stdout).toContain('no-op: TAX_INVOICE sequence for FY 2036-37 is already at 1');

    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seq.lastAllocatedSerial).toBe(1);
  });

  it('7. Rejection of a lower baseline', async () => {
    // Advancing to 100 first
    await execFileAsync(
      process.execPath,
      [
        bundledBaselineCli,
        '--target',
        'test',
        '--document-type',
        'TAX_INVOICE',
        '--financial-year',
        rehearsalFyCode,
        '--serial',
        '100',
        '--expect-database',
        testDatabaseName,
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
    );

    // Now attempt to lower to 50
    let errLower: ExecError | undefined;
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
          rehearsalFyCode,
          '--serial',
          '50',
          '--expect-database',
          testDatabaseName,
        ],
        { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
      );
    } catch (e: unknown) {
      errLower = e as ExecError;
    }

    expect(errLower?.code).not.toBe(0);
    expect(errLower?.stderr || errLower?.stdout).toContain(
      'Refusing to lower TAX_INVOICE sequence for FY 2036-37 from 100 to 50 — sequences are never decreased',
    );

    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seq.lastAllocatedSerial).toBe(100);
  });

  it('8. Read-only EI preflight execution', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        bundledPreflightCli,
        '--target',
        'test',
        '--financial-year',
        rehearsalFyCode,
        '--external-high-water-mark',
        '100',
        '--expect-database',
        testDatabaseName,
        '--json',
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DOTENV_CONFIG_QUIET: 'true' } },
    );

    const cleanOutput = stdout
      .split('\n')
      .filter((line) => !line.trim().startsWith('◇'))
      .join('\n')
      .trim();
    const jsonStartIndex = cleanOutput.indexOf('{');
    const jsonEndIndex = cleanOutput.lastIndexOf('}');
    expect(jsonStartIndex).toBeGreaterThanOrEqual(0);
    const jsonText = cleanOutput.slice(jsonStartIndex, jsonEndIndex + 1);
    const report = JSON.parse(jsonText);

    expect(report.targetFinancialYear).toBe(rehearsalFyCode);
    expect(report.sequenceState.lastAllocatedSerial).toBe(100);
    expect(report.highWaterMark.nextProposedSerial).toBe(101);
    expect(report.readinessBreakdown.isPreparationReady).toBe(true);
    // Cutover is guarded: without accountant manifest, formal production cutover is blocked
    expect(report.readinessBreakdown.isProductionCutoverReady).toBe(false);

    // Preflight must never mutate the sequence
    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seq.lastAllocatedSerial).toBe(100);
  });

  it('9. Normal invoice number allocation behavior continues from baseline + 1', async () => {
    const allocatedSerial = await prisma.$transaction((tx) =>
      allocateDocumentSerial(tx, 'TAX_INVOICE', rehearsalFyId),
    );
    expect(allocatedSerial).toBe(101);

    const invoiceNumber = formatDocumentNumber(DOCUMENT_PREFIXES.TAX_INVOICE, rehearsalFyCode, allocatedSerial);
    expect(invoiceNumber).toBe('EI/36-37/0101');

    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType_financialYearId: { documentType: 'TAX_INVOICE', financialYearId: rehearsalFyId } },
    });
    expect(seq.lastAllocatedSerial).toBe(101);
  });
});
