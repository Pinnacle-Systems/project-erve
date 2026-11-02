import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { createHeldOperation, createOperator, LIVE_GSTIN } from '../test/gst-claim-fixtures.js';
import { claimFingerprint, AUDIT_ACTION_RELEASED } from './gst-verification-reconciliation.js';

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = (name: string) => path.join(apiRoot, 'dist-bundle', `${name}.js`);
const review = bundle('gst-verification-review');
const reconcile = bundle('gst-verification-reconcile');
const databaseName = new URL(process.env.DATABASE_URL!).pathname.replace(/^\//, '');

// Always rebuild: a stale bundle would silently test old code.
beforeAll(() => {
  execFileSync(process.execPath, [path.join(apiRoot, 'esbuild.config.mjs')], {
    cwd: apiRoot,
    stdio: 'pipe',
  });
});
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

async function run(script: string, args: string[], env: Record<string, string> = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args], {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const target = ['--target', 'test', '--expect-database', databaseName];
// Production env validation requires an absolute upload directory.
const PRODUCTION_ENV = { NODE_ENV: 'production', FILE_STORAGE_DIR: os.tmpdir() };

describe('packaged GST claim CLIs', () => {
  it('print help without a database, and the bundles contain no provider code', async () => {
    for (const script of [review, reconcile]) {
      const result = await run(script, ['--help'], { DATABASE_URL: '' });
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/GST Verification Claim/);
      const source = fs.readFileSync(script, 'utf8');
      // The shared env schema names the key variable, but the adapter, its URL and header are absent.
      expect(source).not.toMatch(/gstinapi\.in|x-api-key|GstinApiProvider|GstinApiUsageProvider/);
    }
  });

  it('review lists a held claim with a masked GSTIN and changes nothing', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const result = await run(review, target);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('GST Verification Claim Review (READ ONLY)');
    expect(result.stdout).toContain(held.intent.id);
    expect(result.stdout).toContain(claimFingerprint(held.key));
    expect(result.stdout).not.toContain(LIVE_GSTIN);
    expect(await prisma.gstVerificationClaim.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it.each([
    ['without --expect-database', ['--target', 'test'], /--expect-database is required/],
    [
      'with the wrong database',
      ['--target', 'test', '--expect-database', 'not_this_database'],
      /Database identity mismatch/,
    ],
    [
      'with a target contradicting NODE_ENV',
      ['--target', 'production', '--expect-database', databaseName],
      /Conflicting environment|requires/,
    ],
  ])('review refuses %s', async (_name, args, message) => {
    const result = await run(review, args);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(message);
  });

  it('reconcile requires the declared environment, database and production confirmation', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const operator = await createOperator(['ACCOUNTANT']);
    const op = await prisma.gstVerificationOperation.findUniqueOrThrow({
      where: { id: held.intent.id },
    });
    const base = [
      '--operation-id',
      held.intent.id,
      '--claim-fingerprint',
      claimFingerprint(held.key),
      '--expect-outcome',
      'UNCERTAIN',
      '--decision',
      'NOT_CHARGED',
      '--operator-email',
      operator.email,
      '--reason',
      'Provider ledger shows no matching request.',
      '--evidence-type',
      'PROVIDER_DASHBOARD_LEDGER',
      '--evidence-ref',
      'ledger-export-row-17',
      '--evidence-window-start',
      new Date(op.dispatchedAt!.getTime() - 300_000).toISOString(),
      '--evidence-window-end',
      new Date(op.completedAt!.getTime() + 300_000).toISOString(),
    ];
    const cases: Array<[string, string[], Record<string, string>, RegExp]> = [
      ['no expected database', ['--target', 'test'], {}, /--expect-database is required/],
      [
        'wrong database',
        ['--target', 'test', '--expect-database', 'not_this_database'],
        {},
        /Database identity mismatch/,
      ],
      [
        'production target under NODE_ENV=test',
        [
          '--target',
          'production',
          '--expect-database',
          databaseName,
          '--expect-schema',
          'public',
          '--confirm-production',
        ],
        {},
        /requires explicit NODE_ENV="production"/,
      ],
      [
        'production without confirmation',
        ['--target', 'production', '--expect-database', databaseName, '--expect-schema', 'public'],
        PRODUCTION_ENV,
        /--confirm-production/,
      ],
      [
        'non-production target under NODE_ENV=production',
        ['--target', 'test', '--expect-database', databaseName],
        PRODUCTION_ENV,
        /Conflicting environment configuration/,
      ],
      [
        'duplicate-charge acknowledgement',
        [...target, '--acknowledge-duplicate-charge'],
        {},
        /never releases a claim/,
      ],
      ['unknown flag', [...target, '--force'], {}, /force/],
    ];
    for (const [, extra, env, message] of cases) {
      const result = await run(reconcile, [...base, ...extra], env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(message);
    }
    expect(await prisma.gstVerificationClaim.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('reconcile rejects credential-like or GSTIN text without echoing it, and writes nothing', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const operator = await createOperator(['ACCOUNTANT']);
    for (const secret of ['password=hunter2hunter2', `ledger lists ${LIVE_GSTIN} uncharged`]) {
      const result = await run(reconcile, [
        ...target,
        '--operation-id',
        held.intent.id,
        '--claim-fingerprint',
        claimFingerprint(held.key),
        '--expect-outcome',
        'UNCERTAIN',
        '--decision',
        'UNKNOWN',
        '--operator-email',
        operator.email,
        `--reason=${secret}`,
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/--reason appears to contain/);
      expect(result.stdout + result.stderr).not.toContain('hunter2');
      expect(result.stdout + result.stderr).not.toContain(LIVE_GSTIN);
    }
    expect(await prisma.auditLog.count()).toBe(0);
    expect(await prisma.gstVerificationClaim.count()).toBe(1);
  });

  it('reconcile refuses an unauthorized operator and a double execution, and releases once through the packaged bundle', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const accountant = await createOperator(['ACCOUNTANT']);
    const merchandiser = await createOperator(['MERCHANDISER']);
    const op = await prisma.gstVerificationOperation.findUniqueOrThrow({
      where: { id: held.intent.id },
    });
    const args = (email: string, extra: string[] = []) => [
      ...target,
      '--operation-id',
      held.intent.id,
      '--claim-fingerprint',
      claimFingerprint(held.key),
      '--expect-outcome',
      'UNCERTAIN',
      '--decision',
      'NOT_CHARGED',
      '--operator-email',
      email,
      '--reason',
      'Provider ledger shows no matching request.',
      '--evidence-type',
      'PROVIDER_DASHBOARD_LEDGER',
      '--evidence-ref',
      'ledger-export-row-17',
      '--evidence-window-start',
      new Date(op.dispatchedAt!.getTime() - 300_000).toISOString(),
      '--evidence-window-end',
      new Date(op.completedAt!.getTime() + 300_000).toISOString(),
      ...extra,
    ];

    const denied = await run(reconcile, args(merchandiser.email));
    expect(denied.code).not.toBe(0);
    expect(denied.stderr).toMatch(/must hold one of the roles/);

    const dry = await run(reconcile, args(accountant.email, ['--dry-run']));
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('[DRY RUN]');
    expect(await prisma.gstVerificationClaim.count()).toBe(1);

    const done = await run(reconcile, args(accountant.email));
    expect(done.code).toBe(0);
    expect(done.stdout).toContain('Claim: RELEASED');
    expect(done.stdout).toContain('not proof the provider did not charge');
    expect(await prisma.gstVerificationClaim.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTION_RELEASED } })).toBe(1);

    const again = await run(reconcile, args(accountant.email));
    expect(again.code).not.toBe(0);
    expect(again.stderr).toMatch(/holds no claim/);
    expect(await prisma.auditLog.count()).toBe(1);
  });
});
