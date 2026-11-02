import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GstVerificationEvidence } from '@erve/types';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { gstinVerificationRepository as repository } from '../modules/gst-compliance/gstin-verification.repository.js';
import {
  buildIntent,
  createHeldOperation,
  createOperator,
  keyOf,
  LIVE_GSTIN,
} from '../test/gst-claim-fixtures.js';
import {
  AUDIT_ACTION_RELEASED,
  AUDIT_ACTION_REVIEWED,
  AUDIT_ENTITY_TYPE,
  claimFingerprint,
  findSensitiveContent,
  formatReviewReport,
  GST_EXECUTION_ADVISORY_LOCK,
  GstReconciliationError,
  loadReviewSnapshot,
  maskGstin,
  parseReconcileArgs,
  parseReviewArgs,
  reconcileGstVerificationClaim,
  type ReconcileInput,
} from './gst-verification-reconciliation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let operator: { email: string; userId: string };
const fetchSpy = vi.spyOn(globalThis, 'fetch');

beforeEach(async () => {
  await resetDatabase();
  operator = await createOperator(['ACCOUNTANT']);
  fetchSpy.mockReset();
  fetchSpy.mockRejectedValue(
    new Error('Synthetic guard: no provider or network request is permitted'),
  );
});
afterEach(() => {
  // Every scenario below must complete without any outbound request.
  expect(fetchSpy).not.toHaveBeenCalled();
});
afterAll(async () => {
  fetchSpy.mockRestore();
  await prisma.$disconnect();
});

async function addEvidenceRow(operationId: string) {
  await prisma.gstVerificationEvidence.create({
    data: {
      id: `evidence-${operationId}`,
      operationId,
      requestedGstin: LIVE_GSTIN,
      normalizedGstin: LIVE_GSTIN,
      lookupGstin: LIVE_GSTIN,
      returnedGstin: LIVE_GSTIN,
      mode: 'LIVE',
      level: 'BASIC',
      profile: {},
      retrievedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      ttlSeconds: 1,
      estimatedCredits: 1,
    },
  });
}

type Held = Awaited<ReturnType<typeof createHeldOperation>>;
async function inputFor(
  held: Held,
  overrides: Partial<ReconcileInput> = {},
): Promise<ReconcileInput> {
  const op = await prisma.gstVerificationOperation.findUniqueOrThrow({
    where: { id: held.intent.id },
  });
  return {
    operationId: op.id,
    claimFingerprint: claimFingerprint(held.key),
    expectOutcome: op.outcome as ReconcileInput['expectOutcome'],
    decision: 'NOT_CHARGED',
    operatorEmail: operator.email,
    reason: 'Provider ledger shows no request for this window.',
    evidenceType: 'PROVIDER_DASHBOARD_LEDGER',
    evidenceRef: 'ledger-export-2026-11-02-row-17',
    evidenceWindowStart: new Date((op.dispatchedAt as Date).getTime() - 5 * 60_000),
    evidenceWindowEnd: new Date(
      Math.max(
        (op.completedAt ?? (op.dispatchedAt as Date)).getTime(),
        (op.dispatchedAt as Date).getTime() + 60_000,
      ) + 60_000,
    ),
    confirmDemoSample: false,
    dryRun: false,
    ...overrides,
  };
}
const claims = () => prisma.gstVerificationClaim.count();
const audits = (action?: string) =>
  prisma.auditLog.findMany({
    where: { entityType: AUDIT_ENTITY_TYPE, ...(action ? { action } : {}) },
  });
const refused = (promise: Promise<unknown>, message: RegExp | string) =>
  expect(promise).rejects.toThrow(message);

describe('argument parsing', () => {
  const base = [
    '--target',
    'test',
    '--expect-database',
    'erve_test_x',
    '--operation-id',
    'op1',
    '--claim-fingerprint',
    'abcdef01',
    '--expect-outcome',
    'UNCERTAIN',
    '--operator-email',
    'Ops@Example.com',
    '--reason',
    'Reviewed with provider ledger.',
  ];
  const notCharged = [
    ...base,
    '--decision',
    'NOT_CHARGED',
    '--evidence-type',
    'PROVIDER_DASHBOARD_LEDGER',
    '--evidence-ref',
    'ticket-12345',
    '--evidence-window-start',
    '2026-11-02T10:00:00Z',
    '--evidence-window-end',
    '2026-11-02T10:30:00Z',
  ];
  it('accepts a complete NOT_CHARGED request and normalizes the operator email', () => {
    const parsed = parseReconcileArgs(notCharged);
    expect(parsed.input).toMatchObject({
      decision: 'NOT_CHARGED',
      operatorEmail: 'ops@example.com',
      dryRun: false,
    });
  });
  it.each([
    ['unknown flag', [...notCharged, '--force'], /unknown option/],
    [
      'duplicate-charge acknowledgement',
      [...notCharged, '--acknowledge-duplicate-charge'],
      /never releases a claim/,
    ],
    [
      'missing database identity',
      notCharged.filter((_, i) => i !== 2 && i !== 3),
      /--expect-database is required/,
    ],
    [
      'missing evidence',
      base.concat(['--decision', 'NOT_CHARGED']),
      /requires --evidence-type and --evidence-ref/,
    ],
    [
      'aggregate usage as evidence',
      [
        ...base,
        '--decision',
        'NOT_CHARGED',
        '--evidence-type',
        'DAILY_USAGE',
        '--evidence-ref',
        'stats-me-1',
      ],
      /Daily aggregate usage .* is not evidence/,
    ],
    [
      'credential in reference',
      notCharged.map((a) => (a === 'ticket-12345' ? 'x-api-key: abcdef123456' : a)),
      /--evidence-ref appears to contain credential-like content/,
    ],
    [
      'missing window',
      [
        ...base,
        '--decision',
        'NOT_CHARGED',
        '--evidence-type',
        'PROVIDER_SUPPORT_CONFIRMATION',
        '--evidence-ref',
        'ticket-12345',
      ],
      /evidence-window-start/,
    ],
    [
      'short reason',
      notCharged.map((a) => (a === 'Reviewed with provider ledger.' ? 'short' : a)),
      /--reason must be/,
    ],
    [
      'charged without credits',
      [
        ...base,
        '--decision',
        'CHARGED_NO_RESULT',
        '--evidence-type',
        'PROVIDER_INVOICE_STATEMENT',
        '--evidence-ref',
        'invoice-9912',
      ],
      /requires --charged-credits/,
    ],
    [
      'Demo sample without confirmation',
      [
        ...base,
        '--decision',
        'NOT_CHARGED',
        '--evidence-type',
        'DEMO_SAMPLE_IDENTITY',
        '--evidence-ref',
        'provider-docs-sample',
      ],
      /requires --confirm-demo-sample/,
    ],
    [
      'Demo sample for non-release decision',
      [
        ...base,
        '--decision',
        'UNKNOWN',
        '--evidence-type',
        'DEMO_SAMPLE_IDENTITY',
        '--evidence-ref',
        'provider-docs-sample',
      ],
      /only support a NOT_CHARGED/,
    ],
    ['bad fingerprint', notCharged.map((a) => (a === 'abcdef01' ? 'xyz' : a)), /8-hex/],
  ])('rejects %s', (_name, argv, message) => {
    expect(() => parseReconcileArgs(argv)).toThrow(message);
  });
  it('review parsing is strict as well', () => {
    expect(
      parseReviewArgs(['--target', 'test', '--expect-database', 'd', '--details']).details,
    ).toBe(true);
    expect(() => parseReviewArgs(['--decision', 'NOT_CHARGED'])).toThrow(GstReconciliationError);
  });
  it('masks GSTINs to state code and last three characters', () => {
    expect(maskGstin(LIVE_GSTIN)).toBe('33**********1Z5');
    expect(maskGstin(LIVE_GSTIN)).not.toContain('AAAAA');
  });
});

describe('sensitive operator text', () => {
  const SENSITIVE: Array<[string, string, 'GSTIN' | 'CREDENTIAL']> = [
    ['api key assignment', 'x-api-key: abcdef123456', 'CREDENTIAL'],
    ['password assignment', 'password=hunter2hunter2', 'CREDENTIAL'],
    ['bearer token', 'Authorization Bearer abcdefghijklmnop', 'CREDENTIAL'],
    ['hex blob', 'a3f1c9d8e7b6a5948372615f4e3d2c1b', 'CREDENTIAL'],
    ['aws key id', 'AKIAABCDEFGHIJKLMNOP', 'CREDENTIAL'],
    ['github token', 'ghp_abcdefghijklmnopqrstuvwxyz', 'CREDENTIAL'],
    ['url with userinfo', 'https://opsuser:s3cretpw@provider.example/ledger', 'CREDENTIAL'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl', 'CREDENTIAL'],
    ['prefixed secret key', 'sk_live_abcdefghijklmnopqrst', 'CREDENTIAL'],
    ['private key header', '-----BEGIN RSA PRIVATE KEY-----', 'CREDENTIAL'],
    ['complete GSTIN', 'Matches 33AAAAA0000A1Z5 in the ledger', 'GSTIN'],
    ['lower-case GSTIN', 'gstin 33aaaaa0000a1z5 seen', 'GSTIN'],
    ['spaced GSTIN', 'gstin 33 AAAAA 0000 A 1Z5 seen', 'GSTIN'],
    ['hyphenated GSTIN', 'gstin 33-AAAAA-0000-A-1Z5 seen', 'GSTIN'],
  ];
  const ALLOWED = [
    'Provider ledger shows no request for this window.',
    'ledger-export-2026-11-02-support-ticket-12345',
    'Operation 0b8f0c1e-6f55-4a3e-9d6c-2f3a1b7c9d10 reviewed against masked 33**********1Z5',
    'INV-2026-000123 line 4',
  ];

  // Evasion attempts caught by the detector itself (invisible characters are also
  // refused outright by the field check, which runs first).
  const EVASIONS: Array<[string, string, 'GSTIN' | 'CREDENTIAL']> = [
    ['zero-width space inside a GSTIN', '27AAPFU0939F1Z\u200BV', 'GSTIN'],
    ['soft hyphens between characters', '2\u00AD7AAPFU0939F1ZV', 'GSTIN'],
    [
      'fullwidth GSTIN',
      '\uFF12\uFF17\uFF21\uFF21\uFF30\uFF26\uFF35\uFF10\uFF19\uFF13\uFF19\uFF26\uFF11\uFF3A\uFF36',
      'GSTIN',
    ],
    ['slash separated GSTIN', '27/AAPFU/0939/F/1/Z/V', 'GSTIN'],
    ['comma separated GSTIN', '27,AAPFU,0939,F1ZV', 'GSTIN'],
    ['percent-encoded GSTIN', '27AAPFU0939F1Z%56', 'GSTIN'],
    ['fullwidth equals sign', 'password\uFF1Dhunter2hunter2', 'CREDENTIAL'],
    ['keyword split by zero-width space', 'pass\u200Bword=hunter2hunter2', 'CREDENTIAL'],
    ['keyword without separator', 'password is hunter2', 'CREDENTIAL'],
    ['api key without separator', 'api key abc123', 'CREDENTIAL'],
    ['short separated base64url', 'Xk9_Lm2-Qp7Zr4Tn8Vb3Wc6Yd1Fg5Hj0', 'CREDENTIAL'],
    ['mixed-case alphanumeric blob', 'Xk9Lm2Qp7Zr4Tn8Vb3Wc6Yd1', 'CREDENTIAL'],
    ['double percent-encoded GSTIN', '27AAPFU0939F1Z%2556', 'GSTIN'],
    ['key after underscore', 'access_token=abcd1234', 'CREDENTIAL'],
    ['prefixed upper-case key', 'AWS_SECRET_ACCESS_KEY=abcd1234', 'CREDENTIAL'],
    ['environment style password', 'DB_PASSWORD=hunter22', 'CREDENTIAL'],
    ['camel-case key', 'myApiKey=abcd1234', 'CREDENTIAL'],
    ['camel-case token', 'csrfToken=abcd1234', 'CREDENTIAL'],
  ];
  it.each([...SENSITIVE, ...EVASIONS])('detects %s', (_name, value, kind) => {
    expect(findSensitiveContent(value)).toBe(kind);
  });
  it.each([
    'support/tickets/2026/11/12345678',
    'token: 5 credits',
    'password reset requested by the vendor',
    'provider authorization: granted',
  ])('does not block ordinary prose or paths: %s', (value) => {
    expect(findSensitiveContent(value)).toBeNull();
  });
  it.each(ALLOWED)('allows an ordinary reference: %s', (value) => {
    expect(findSensitiveContent(value)).toBeNull();
  });

  const base = [
    '--target',
    'test',
    '--expect-database',
    'd',
    '--operation-id',
    'op1',
    '--claim-fingerprint',
    'abcdef01',
    '--expect-outcome',
    'DISPATCHED',
    '--operator-email',
    'ops@example.com',
    '--decision',
    'NOT_CHARGED',
    '--evidence-type',
    'PROVIDER_DASHBOARD_LEDGER',
    '--evidence-window-start',
    '2026-11-02T10:00:00Z',
    '--evidence-window-end',
    '2026-11-02T10:30:00Z',
  ];
  // `--flag=value` keeps values that start with '-' (e.g. a PEM header) intact.
  const withFields = (fields: { reason?: string; ref?: string; assessment?: string }) => [
    ...base,
    `--reason=${fields.reason ?? 'Reviewed with the provider ledger.'}`,
    `--evidence-ref=${fields.ref ?? 'ticket-12345'}`,
    `--no-active-worker-assessment=${fields.assessment ?? 'All API replicas were stopped and the process list checked.'}`,
  ];
  const fieldCases = [
    ['--reason', 'reason', (v: string) => withFields({ reason: v })],
    ['--evidence-ref', 'evidenceRef', (v: string) => withFields({ ref: v })],
    [
      '--no-active-worker-assessment',
      'noActiveWorkerAssessment',
      (v: string) => withFields({ assessment: v }),
    ],
  ] as const;

  it('accepts ordinary text in every persisted field', () => {
    expect(() => parseReconcileArgs(withFields({}))).not.toThrow();
  });

  describe.each(fieldCases)('%s', (flag, _key, build) => {
    it.each(SENSITIVE)('rejects %s without echoing it', (_name, value, kind) => {
      let message = '';
      try {
        parseReconcileArgs(build(value));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(flag);
      expect(message).toContain(kind === 'GSTIN' ? 'complete GSTIN' : 'credential-like content');
      expect(message).not.toContain(value);
      expect(message).not.toMatch(/AAAAA|hunter2|s3cretpw|abcdef123456/i);
    });
  });

  it.each(fieldCases)(
    'the reconcile function enforces the same rule for %s and persists nothing',
    async (flag, key) => {
      const held = await createHeldOperation({ kind: 'DISPATCHED', ageMinutes: 30 });
      const error = await reconcileGstVerificationClaim(
        await inputFor(held, {
          noActiveWorkerAssessment: 'All API replicas were stopped and the process list checked.',
          [key]: 'password=hunter2hunter2',
        }),
      ).catch((e: Error) => e);
      expect(error).toBeInstanceOf(GstReconciliationError);
      expect((error as Error).message).toContain(flag);
      expect((error as Error).message).not.toContain('hunter2');
      expect(await claims()).toBe(1);
      expect(await prisma.auditLog.count()).toBe(0);
    },
  );

  it.each(fieldCases)('%s refuses control and invisible characters', (flag, _key, build) => {
    const values = [
      'first line of the text\nsecond line of the text',
      `ansi sequence ${String.fromCharCode(27)}[31m in the text`,
      `zero${String.fromCharCode(0x200b)}width character in the text`,
    ];
    for (const value of values) {
      let message = '';
      try {
        parseReconcileArgs(build(value));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(flag);
      expect(message).toMatch(/control or invisible characters|printable/);
    }
  });

  it('never echoes stray words or unknown option values from the argument parser', () => {
    const attempts: string[][] = [
      [...base, '--reason', 'Provider ledger', 'password:', 'hunter2hunter2'],
      [...base, '--foo=hunter2hunter2'],
      [...base, '--hunter2hunter2'],
    ];
    for (const argv of attempts) {
      let message = '';
      try {
        parseReconcileArgs(argv);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain('hunter2');
      expect(message).not.toContain('password');
    }
    expect(() => parseReconcileArgs([...base, '--reason', 'a', 'extra'])).toThrow(
      /quote any value that contains spaces/,
    );
  });

  it('requires identifier-shaped operation ids and operator emails, without echoing them', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    for (const overrides of [
      { operationId: 'password=hunter2hunter2' },
      { operationId: 'x'.repeat(65) },
      { operatorEmail: 'not an email hunter2' },
      { operatorEmail: 'password=hunter2hunter2@example.com' },
      { operatorEmail: `ops${String.fromCharCode(27)}[31m@example.com` },
    ] satisfies Partial<ReconcileInput>[]) {
      const error = await reconcileGstVerificationClaim(await inputFor(held, overrides)).catch(
        (e: Error) => e,
      );
      expect(error).toBeInstanceOf(GstReconciliationError);
      expect((error as Error).message).toMatch(
        /--operation-id must be|--operator-email (must be|appears|must not contain)/,
      );
      expect((error as Error).message).not.toContain('hunter2');
    }
    expect(await claims()).toBe(1);
  });

  it('keeps a complete GSTIN out of the audit trail even when the operator supplies one', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, { reason: `Provider ledger lists ${LIVE_GSTIN} with no charge.` }),
      ),
      /complete GSTIN/,
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe('read-only review', () => {
  it('lists held claims with masked identity, counts and fingerprints, and writes nothing', async () => {
    const uncertain = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await createHeldOperation({
      kind: 'DISPATCHED',
      mode: 'DEMO',
      gstin: '33CCCCC0000C1Z7',
      level: 'COMPLETE',
      ageMinutes: 5,
    });
    const done = buildIntent({ gstin: '33DDDDD0000D1Z8' });
    await repository.prepare(done);
    await repository.claim(done, keyOf(done));
    await repository.fail(done, 'NOT_FOUND', false);

    const before = {
      ops: await prisma.gstVerificationOperation.count(),
      claims: await claims(),
      audits: await prisma.auditLog.count(),
    };
    const snapshot = await loadReviewSnapshot();
    expect({
      ops: await prisma.gstVerificationOperation.count(),
      claims: await claims(),
      audits: await prisma.auditLog.count(),
    }).toEqual(before);

    expect(snapshot.activeClaims).toBe(2);
    expect(snapshot.totalOperations).toBe(3);
    expect(snapshot.outcomeCounts).toEqual(
      expect.arrayContaining([
        { mode: 'LIVE', outcome: 'UNCERTAIN', count: 1 },
        { mode: 'DEMO', outcome: 'DISPATCHED', count: 1 },
        { mode: 'LIVE', outcome: 'FAILED', count: 1 },
      ]),
    );
    expect(snapshot.held.map((r) => r.operationId)).toContain(uncertain.intent.id);
    const row = snapshot.held.find((r) => r.operationId === uncertain.intent.id)!;
    expect(row).toMatchObject({
      mode: 'LIVE',
      level: 'BASIC',
      maskedGstin: maskGstin(LIVE_GSTIN),
      outcome: 'UNCERTAIN',
      failureCode: 'NETWORK',
      evidenceStatus: 'NONE',
      claimFingerprint: claimFingerprint(uncertain.key),
      reviewCount: 0,
      lastReviewedAt: null,
    });
    expect(row.claimAgeMinutes).toBeGreaterThanOrEqual(30);
    expect(row.reviewAfter).not.toBeNull();
    const young = snapshot.held.find((r) => r.outcome === 'DISPATCHED')!;
    expect(young.readiness).toMatch(/Not yet eligible/);

    const report = formatReviewReport(snapshot);
    expect(report).toContain('READ ONLY');
    expect(report).not.toContain(LIVE_GSTIN);
    expect(report).not.toContain('33CCCCC0000C1Z7');
    expect(report).toContain(uncertain.intent.id);
  });

  it('separates anomalies and shows released claims after reconciliation', async () => {
    const stray = buildIntent({ gstin: '33EEEEE0000E1Z9' });
    await repository.prepare(stray);
    await repository.claim(stray, keyOf(stray));
    await prisma.gstVerificationOperation.update({
      where: { id: stray.id },
      data: { outcome: 'SUCCEEDED' },
    });
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await reconcileGstVerificationClaim(await inputFor(held));

    const snapshot = await loadReviewSnapshot();
    expect(snapshot.anomalies.map((r) => [r.operationId, r.flags])).toEqual([
      [stray.id, ['CLAIM_ON_NON_HELD_OUTCOME']],
    ]);
    expect(snapshot.held).toHaveLength(0);
    expect(snapshot.released.map((r) => r.operationId)).toEqual([held.intent.id]);
    expect(snapshot.released[0]).toMatchObject({
      outcome: 'UNCERTAIN',
      reviewCount: 1,
      lastDecision: 'NOT_CHARGED',
    });
    expect(formatReviewReport(snapshot, { details: true })).toContain('claim already released');
  });
});

describe('reconciliation decisions', () => {
  it('NOT_CHARGED releases an UNCERTAIN claim, leaves history untouched and writes a complete audit entry', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const opBefore = await prisma.gstVerificationOperation.findUniqueOrThrow({
      where: { id: held.intent.id },
    });

    const result = await reconcileGstVerificationClaim(await inputFor(held));
    expect(result).toMatchObject({
      claimDisposition: 'RELEASED',
      previousOutcome: 'UNCERTAIN',
      dryRun: false,
      auditAction: AUDIT_ACTION_RELEASED,
    });
    expect(await claims()).toBe(0);
    expect(
      await prisma.gstVerificationOperation.findUniqueOrThrow({ where: { id: held.intent.id } }),
    ).toEqual(opBefore);
    expect(await prisma.gstVerificationEvidence.count()).toBe(0);

    const [entry] = await audits(AUDIT_ACTION_RELEASED);
    expect(entry).toMatchObject({ actorId: operator.userId, entityId: held.intent.id });
    expect(entry!.metadata).toMatchObject({
      decision: 'NOT_CHARGED',
      claimDisposition: 'RELEASED',
      previousOutcome: 'UNCERTAIN',
      mode: 'LIVE',
      claimFingerprint: claimFingerprint(held.key),
      operatorId: operator.userId,
      operatorEmail: operator.email,
      evidenceType: 'PROVIDER_DASHBOARD_LEDGER',
      evidenceRef: 'ledger-export-2026-11-02-row-17',
      possibleDuplicateCharge: null,
      eligibility: {
        advisoryLockHeld: true,
        operationRowLocked: true,
        evidenceRowPresent: false,
        claimKeyMatchedOperation: true,
        fingerprintMatched: true,
        outcomeMatchedExpectation: true,
        anomalyFlags: [],
      },
    });
    expect(JSON.stringify(entry!.metadata)).not.toContain(LIVE_GSTIN);

    // No retry was started; the key is free for a later, separately confirmed verification.
    const next = buildIntent();
    await repository.prepare(next);
    expect(await repository.claim(next, keyOf(next))).toBe(true);
  });

  it('dry-run runs every check under lock and writes nothing', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const result = await reconcileGstVerificationClaim(await inputFor(held, { dryRun: true }));
    expect(result).toMatchObject({ dryRun: true, claimDisposition: 'RELEASED', auditAction: null });
    expect(await claims()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, {
          dryRun: true,
          evidenceWindowStart: new Date(Date.now() - 29.9 * 60_000),
        }),
      ),
      /evidence window must cover/,
    );
  });

  it.each(['UNKNOWN', 'IN_PROGRESS'] as const)(
    '%s is audit-only and retains the claim',
    async (decision) => {
      const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
      const result = await reconcileGstVerificationClaim(
        await inputFor(held, {
          decision,
          evidenceType: undefined,
          evidenceRef: undefined,
          evidenceWindowStart: undefined,
          evidenceWindowEnd: undefined,
        }),
      );
      expect(result).toMatchObject({
        claimDisposition: 'RETAINED',
        auditAction: AUDIT_ACTION_REVIEWED,
      });
      expect(await claims()).toBe(1);
      const [entry] = await audits(AUDIT_ACTION_REVIEWED);
      expect(entry!.metadata).toMatchObject({ decision, claimDisposition: 'RETAINED' });
      const row = (await loadReviewSnapshot()).held[0]!;
      expect(row).toMatchObject({ reviewCount: 1, lastDecision: decision });
      // Repeated reviews are allowed (append-only) and the claim is still held.
      await reconcileGstVerificationClaim(
        await inputFor(held, {
          decision,
          evidenceType: undefined,
          evidenceRef: undefined,
          evidenceWindowStart: undefined,
          evidenceWindowEnd: undefined,
        }),
      );
      expect(await audits(AUDIT_ACTION_REVIEWED)).toHaveLength(2);
      expect(await claims()).toBe(1);
    },
  );

  it('CHARGED_NO_RESULT records the charge evidence and never releases the claim', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const result = await reconcileGstVerificationClaim(
      await inputFor(held, {
        decision: 'CHARGED_NO_RESULT',
        chargedCredits: 1,
        evidenceType: 'PROVIDER_INVOICE_STATEMENT',
        evidenceRef: 'invoice-9912-line-4',
        evidenceWindowStart: undefined,
        evidenceWindowEnd: undefined,
      }),
    );
    expect(result).toMatchObject({ claimDisposition: 'RETAINED' });
    expect(result.note).toMatch(/separately authorized duplicate-charge handling/);
    expect(await claims()).toBe(1);
    expect((await audits(AUDIT_ACTION_REVIEWED))[0]!.metadata).toMatchObject({
      decision: 'CHARGED_NO_RESULT',
      chargedCredits: 1,
      possibleDuplicateCharge: true,
      evidenceType: 'PROVIDER_INVOICE_STATEMENT',
    });
  });

  it('unknown billing outcome stays blocked: no combination of arguments releases without evidence', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    expect(() =>
      parseReconcileArgs([
        '--target',
        'test',
        '--expect-database',
        'd',
        '--operation-id',
        held.intent.id,
        '--claim-fingerprint',
        claimFingerprint(held.key),
        '--expect-outcome',
        'UNCERTAIN',
        '--operator-email',
        operator.email,
        '--reason',
        'Billing outcome could not be established.',
        '--decision',
        'NOT_CHARGED',
      ]),
    ).toThrow(/requires --evidence-type/);
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, { evidenceType: undefined, evidenceRef: undefined }),
      ),
      /requires --evidence-type/,
    );
    expect(await claims()).toBe(1);
  });

  it('refuses an evidence window that does not cover the operation or lies in the future', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const op = await prisma.gstVerificationOperation.findUniqueOrThrow({
      where: { id: held.intent.id },
    });
    const dispatched = op.dispatchedAt as Date;
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, { evidenceWindowStart: new Date(dispatched.getTime() + 1000) }),
      ),
      /evidence window must cover/,
    );
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, { evidenceWindowEnd: new Date(Date.now() + 3_600_000) }),
      ),
      /in the future/,
    );
    expect(await claims()).toBe(1);
  });
});

describe('interrupted DISPATCHED operations', () => {
  it('refuses release while the operation may still be executing', async () => {
    const held = await createHeldOperation({ kind: 'DISPATCHED', ageMinutes: 5 });
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, {
          noActiveWorkerAssessment: 'API replicas were stopped and the process list checked.',
        }),
      ),
      /may still be executing/,
    );
    expect(await claims()).toBe(1);
  });

  it('is eligible for investigation, not automatic release: needs a documented no-active-worker assessment', async () => {
    const held = await createHeldOperation({ kind: 'DISPATCHED', ageMinutes: 30 });
    await refused(
      reconcileGstVerificationClaim(await inputFor(held)),
      /requires --no-active-worker-assessment/,
    );
    expect(await claims()).toBe(1);
    await reconcileGstVerificationClaim(
      await inputFor(held, {
        noActiveWorkerAssessment: 'API replicas were stopped and the process list checked.',
      }),
    );
    expect(await claims()).toBe(0);
    expect((await audits(AUDIT_ACTION_RELEASED))[0]!.metadata).toMatchObject({
      previousOutcome: 'DISPATCHED',
      noActiveWorkerAssessment: 'API replicas were stopped and the process list checked.',
    });
    // The historical outcome is not rewritten.
    expect(
      (await prisma.gstVerificationOperation.findUniqueOrThrow({ where: { id: held.intent.id } }))
        .outcome,
    ).toBe('DISPATCHED');
  });

  it('audit-only decisions on a young DISPATCHED claim are allowed and release nothing', async () => {
    const held = await createHeldOperation({ kind: 'DISPATCHED', ageMinutes: 1 });
    await reconcileGstVerificationClaim(
      await inputFor(held, {
        decision: 'IN_PROGRESS',
        evidenceType: undefined,
        evidenceRef: undefined,
        evidenceWindowStart: undefined,
        evidenceWindowEnd: undefined,
      }),
    );
    expect(await claims()).toBe(1);
  });
});

describe('Demo and Live isolation', () => {
  const demoSample = {
    evidenceType: 'DEMO_SAMPLE_IDENTITY',
    evidenceRef: 'provider-docs-free-sample-gstin',
    confirmDemoSample: true,
    evidenceWindowStart: undefined,
    evidenceWindowEnd: undefined,
  } as const;
  it('releases a DEMO claim on the official sample classification with confirmation and audits it', async () => {
    const demo = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'DEMO', ageMinutes: 30 });
    const live = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'LIVE', ageMinutes: 30 });
    await reconcileGstVerificationClaim(await inputFor(demo, demoSample));
    expect(await prisma.gstVerificationClaim.findMany({ select: { operationId: true } })).toEqual([
      { operationId: live.intent.id },
    ]);
    expect((await audits(AUDIT_ACTION_RELEASED))[0]!.metadata).toMatchObject({
      mode: 'DEMO',
      evidenceType: 'DEMO_SAMPLE_IDENTITY',
      demoSampleConfirmed: true,
    });
  });
  it('never lets Demo evidence release a Live claim', async () => {
    const live = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'LIVE', ageMinutes: 30 });
    await refused(
      reconcileGstVerificationClaim(await inputFor(live, demoSample)),
      /can never justify releasing a Live claim/,
    );
    expect(await claims()).toBe(1);
  });
  it('refuses a Demo-labelled operation that carries a credit estimate', async () => {
    const demo = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'DEMO', ageMinutes: 30 });
    await prisma.gstVerificationOperation.update({
      where: { id: demo.intent.id },
      data: { estimatedCredits: 1 },
    });
    await refused(
      reconcileGstVerificationClaim(await inputFor(demo, demoSample)),
      /non-zero credit estimate/,
    );
  });
  it('keeps Live and Demo claims for the same GSTIN independent', async () => {
    const live = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'LIVE', ageMinutes: 30 });
    const demo = await createHeldOperation({ kind: 'UNCERTAIN', mode: 'DEMO', ageMinutes: 30 });
    expect(live.key).not.toBe(demo.key);
    await reconcileGstVerificationClaim(await inputFor(live));
    expect(await prisma.gstVerificationClaim.findMany({ select: { key: true } })).toEqual([
      { key: demo.key },
    ]);
  });
});

describe('eligibility and safeguards', () => {
  it('requires an existing, ACTIVE operator holding ACCOUNTANT or ADMIN', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, { operatorEmail: 'nobody@gst-claims.test' }),
      ),
      /does not match an existing user/,
    );
    const inactive = await createOperator(['ACCOUNTANT'], 'INACTIVE');
    await refused(
      reconcileGstVerificationClaim(await inputFor(held, { operatorEmail: inactive.email })),
      /not ACTIVE/,
    );
    const wrongRole = await createOperator(['MERCHANDISER']);
    await refused(
      reconcileGstVerificationClaim(await inputFor(held, { operatorEmail: wrongRole.email })),
      /must hold one of the roles/,
    );
    expect(await claims()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
    const admin = await createOperator(['ADMIN']);
    await reconcileGstVerificationClaim(
      await inputFor(held, { operatorEmail: admin.email.toUpperCase() }),
    );
    expect((await audits(AUDIT_ACTION_RELEASED))[0]!.actorId).toBe(admin.userId);
  });

  it.each([
    ['unknown operation', async () => ({ operationId: 'does-not-exist' }), /does not exist/],
    [
      'wrong fingerprint',
      async () => ({ claimFingerprint: '00000000' }),
      /fingerprint does not match/,
    ],
    [
      'stale outcome expectation',
      async () => ({ expectOutcome: 'DISPATCHED' as const }),
      /not the expected DISPATCHED/,
    ],
  ])('refuses %s', async (_name, overrides, message) => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await refused(reconcileGstVerificationClaim(await inputFor(held, await overrides())), message);
    expect(await claims()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('refuses operations that completed normally (SUCCEEDED, FAILED, CACHE_HIT, PREPARED)', async () => {
    for (const outcome of ['SUCCEEDED', 'FAILED', 'CACHE_HIT', 'PREPARED']) {
      const intent = buildIntent({ gstin: `33${outcome.slice(0, 5).padEnd(5, 'A')}0000A1Z5` });
      await repository.prepare(intent);
      await prisma.gstVerificationOperation.update({ where: { id: intent.id }, data: { outcome } });
      await refused(
        reconcileGstVerificationClaim({
          operationId: intent.id,
          claimFingerprint: claimFingerprint(keyOf(intent)),
          expectOutcome: 'UNCERTAIN',
          decision: 'UNKNOWN',
          operatorEmail: operator.email,
          reason: 'Checking an ineligible operation.',
          confirmDemoSample: false,
          dryRun: false,
        }),
        /only DISPATCHED or UNCERTAIN/,
      );
    }
  });

  it('audit-only entries record the observed state, including the absence of an evidence row', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await reconcileGstVerificationClaim(
      await inputFor(held, {
        decision: 'UNKNOWN',
        evidenceType: undefined,
        evidenceRef: undefined,
        evidenceWindowStart: undefined,
        evidenceWindowEnd: undefined,
      }),
    );
    expect((await audits(AUDIT_ACTION_REVIEWED))[0]!.metadata).toMatchObject({
      eligibility: {
        evidenceRowPresent: false,
        claimKeyMatchedOperation: true,
        fingerprintMatched: true,
        outcomeMatchedExpectation: true,
        anomalyFlags: [],
      },
    });
  });

  it.each([
    ['NOT_CHARGED', {}],
    [
      'CHARGED_NO_RESULT',
      {
        decision: 'CHARGED_NO_RESULT' as const,
        chargedCredits: 1,
        evidenceType: 'PROVIDER_INVOICE_STATEMENT' as const,
        evidenceRef: 'invoice-9912-line-4',
        evidenceWindowStart: undefined,
        evidenceWindowEnd: undefined,
      },
    ],
    ['UNKNOWN', { decision: 'UNKNOWN' as const, evidenceType: undefined, evidenceRef: undefined }],
    [
      'IN_PROGRESS',
      { decision: 'IN_PROGRESS' as const, evidenceType: undefined, evidenceRef: undefined },
    ],
    ['dry-run NOT_CHARGED', { dryRun: true }],
  ])(
    'refuses %s on a held operation that already has an evidence row (anomaly), writing nothing',
    async (_name, overrides) => {
      const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
      await addEvidenceRow(held.intent.id);
      await refused(
        reconcileGstVerificationClaim(await inputFor(held, overrides as Partial<ReconcileInput>)),
        /evidence already exists for this operation.*EVIDENCE_PRESENT_ON_HELD_OPERATION.*cannot be reconciled/,
      );
      expect(await claims()).toBe(1);
      expect(await prisma.auditLog.count()).toBe(0);
    },
  );

  it('refuses every decision on an UNCERTAIN operation with no completion time (anomaly)', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await prisma.gstVerificationOperation.update({
      where: { id: held.intent.id },
      data: { completedAt: null },
    });
    await refused(
      reconcileGstVerificationClaim(
        await inputFor(held, {
          decision: 'IN_PROGRESS',
          evidenceType: undefined,
          evidenceRef: undefined,
          evidenceWindowStart: undefined,
          evidenceWindowEnd: undefined,
        }),
      ),
      /UNCERTAIN_WITHOUT_COMPLETION_TIME/,
    );
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('refuses a release when evidence already exists for the operation', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await prisma.gstVerificationEvidence.create({
      data: {
        id: 'evidence-fixture',
        operationId: held.intent.id,
        requestedGstin: LIVE_GSTIN,
        normalizedGstin: LIVE_GSTIN,
        lookupGstin: LIVE_GSTIN,
        returnedGstin: LIVE_GSTIN,
        mode: 'LIVE',
        level: 'BASIC',
        profile: {},
        retrievedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        ttlSeconds: 1,
        estimatedCredits: 1,
      },
    });
    await refused(reconcileGstVerificationClaim(await inputFor(held)), /evidence already exists/);
    expect(await claims()).toBe(1);
    expect((await loadReviewSnapshot()).anomalies[0]!.flags).toContain(
      'EVIDENCE_PRESENT_ON_HELD_OPERATION',
    );
  });

  it('refuses when the claim key no longer matches the operation identity', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await prisma.$executeRaw`UPDATE gst_verification_claims SET key = 'LIVE:tampered:BASIC' WHERE operation_id = ${held.intent.id}`;
    await refused(reconcileGstVerificationClaim(await inputFor(held)), /claim key does not match/);
    expect(await claims()).toBe(1);
  });

  it('a second reconciliation of the same operation is refused', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await reconcileGstVerificationClaim(await inputFor(held));
    await refused(reconcileGstVerificationClaim(await inputFor(held)), /holds no claim/);
    expect(await audits(AUDIT_ACTION_RELEASED)).toHaveLength(1);
  });
});

describe('concurrency', () => {
  async function holdAdvisoryLock() {
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${GST_EXECUTION_ADVISORY_LOCK}))`;
        acquired();
        await gate;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );
    await ready;
    return { release, done };
  }
  const waitsFor = async (promise: Promise<unknown>, ms = 400) =>
    (await Promise.race([
      promise.then(
        () => 'settled',
        () => 'settled',
      ),
      new Promise((r) => setTimeout(() => r('waiting'), ms)),
    ])) === 'waiting';

  it('waits on the claim-acquisition advisory lock before touching anything', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const lock = await holdAdvisoryLock();
    const pending = reconcileGstVerificationClaim(await inputFor(held));
    expect(await waitsFor(pending)).toBe(true);
    expect(await claims()).toBe(1);
    lock.release();
    await lock.done;
    await pending;
    expect(await claims()).toBe(0);
  });

  it('re-reads under the row lock and refuses when the operation completed concurrently', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (locked = resolve));
    const completing = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM gst_verification_operations WHERE id = ${held.intent.id} FOR UPDATE`;
      locked();
      await gate;
      // What complete()/fail() do: change the outcome and drop the claim.
      await tx.gstVerificationOperation.update({
        where: { id: held.intent.id },
        data: { outcome: 'SUCCEEDED' },
      });
      await tx.gstVerificationClaim.deleteMany({ where: { operationId: held.intent.id } });
    });
    await ready;
    const pending = reconcileGstVerificationClaim(await inputFor(held));
    const outcome = pending.then(
      () => 'ok',
      (error: Error) => error.message,
    );
    expect(await waitsFor(outcome)).toBe(true);
    release();
    await completing;
    expect(await outcome).toMatch(/operation outcome is SUCCEEDED/);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('exactly one of two simultaneous identical reconciliations succeeds', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const input = await inputFor(held);
    const results = await Promise.allSettled([
      reconcileGstVerificationClaim(input),
      reconcileGstVerificationClaim(input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await audits(AUDIT_ACTION_RELEASED)).toHaveLength(1);
    expect(await claims()).toBe(0);
  });

  it('is serialized with claim acquisition: a competing verification sees either the old claim or the released key, never both', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    const competitor = buildIntent();
    await repository.prepare(competitor);
    const lock = await holdAdvisoryLock();
    const reconcile = reconcileGstVerificationClaim(await inputFor(held));
    const claim = repository.claim(competitor, keyOf(competitor));
    await new Promise((r) => setTimeout(r, 300));
    lock.release();
    await lock.done;
    const [, acquired] = await Promise.all([reconcile, claim]);
    const rows = await prisma.gstVerificationClaim.findMany({ select: { operationId: true } });
    if (acquired) expect(rows).toEqual([{ operationId: competitor.id }]);
    else {
      expect(rows).toEqual([]);
      expect(
        (await prisma.gstVerificationOperation.findUniqueOrThrow({ where: { id: competitor.id } }))
          .outcome,
      ).toBe('PREPARED');
    }
    expect(await audits(AUDIT_ACTION_RELEASED)).toHaveLength(1);
  });
});

describe('atomicity', () => {
  it('rolls back, leaving the claim unchanged, when the audit insert fails', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION gst_test_block_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER gst_test_block_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION gst_test_block_audit()',
    );
    try {
      await refused(reconcileGstVerificationClaim(await inputFor(held)), /synthetic audit failure/);
      expect(await claims()).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER gst_test_block_audit ON audit_logs');
      await prisma.$executeRawUnsafe('DROP FUNCTION gst_test_block_audit()');
    }
    expect(await prisma.auditLog.count()).toBe(0);
    await reconcileGstVerificationClaim(await inputFor(held));
    expect(await claims()).toBe(0);
  });

  it('rolls back the audit row when the claim can no longer be removed', async () => {
    const held = await createHeldOperation({ kind: 'UNCERTAIN', ageMinutes: 30 });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION gst_test_block_claim_delete() RETURNS trigger AS $$ BEGIN RETURN NULL; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER gst_test_block_claim_delete BEFORE DELETE ON gst_verification_claims FOR EACH ROW EXECUTE FUNCTION gst_test_block_claim_delete()',
    );
    try {
      await refused(reconcileGstVerificationClaim(await inputFor(held)), /transaction rolled back/);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await claims()).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER gst_test_block_claim_delete ON gst_verification_claims',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION gst_test_block_claim_delete()');
    }
  });
});

describe('normal verification lifecycle is unaffected', () => {
  it('successful, failed and cache-hit executions still release their claims without any audit row', async () => {
    const evidence = (intent: ReturnType<typeof buildIntent>) =>
      ({
        id: `evidence-${intent.id}`,
        requestedGstin: intent.target.gstin,
        normalizedGstin: intent.target.gstin,
        lookupGstin: intent.target.gstin,
        returnedGstin: intent.target.gstin,
        mode: intent.mode,
        level: intent.level,
        retrievedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ttlSeconds: 60,
        estimatedCredits: 1,
        actualCredits: 1,
        billingCategory: 'live',
        governmentStatus: 'ACTIVE',
        legalName: 'Synthetic',
        tradeName: null,
        taxpayerType: null,
        registrationDate: null,
        registeredAddress: null,
        businessConstitution: null,
        filingFrequency: null,
        gstr1FiledTill: null,
        gstr3bFiledTill: null,
        partial: false,
        unavailable: [],
      }) as unknown as GstVerificationEvidence;
    const steps: Array<(i: ReturnType<typeof buildIntent>) => Promise<void>> = [
      (i) => repository.complete(i, evidence(i), 10),
      (i) => repository.fail(i, 'NOT_FOUND', false),
      (i) => repository.cacheHit(i),
    ];
    for (const [index, step] of steps.entries()) {
      const intent = buildIntent({ gstin: `33FFFF${index}0000F1Z5` });
      await repository.prepare(intent);
      expect(await repository.claim(intent, keyOf(intent))).toBe(true);
      expect(await claims()).toBe(1);
      await step(intent);
      expect(await claims()).toBe(0);
    }
    expect(await prisma.auditLog.count()).toBe(0);
    const snapshot = await loadReviewSnapshot();
    expect(snapshot.held).toHaveLength(0);
    expect(snapshot.anomalies).toHaveLength(0);
  });
});

describe('structural guarantees', () => {
  const read = (file: string) => readFileSync(path.join(here, file), 'utf8');
  it('uses the very advisory lock that claim acquisition uses', () => {
    expect(read('../modules/gst-compliance/gstin-verification.repository.ts')).toContain(
      `hashtext(\${'${GST_EXECUTION_ADVISORY_LOCK}'})`,
    );
  });
  it.each([
    'gst-verification-reconciliation.ts',
    'gst-verification-review.cli.ts',
    'gst-verification-reconcile.cli.ts',
  ])('%s has no path to the GSTINAPI provider or network', (file) => {
    const source = read(file);
    const specifiers = [...source.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(
      specifiers.filter((s) =>
        /integrations\/gst|node:(https?|net|tls|dns|http2)|undici|axios|node-fetch/.test(s),
      ),
    ).toEqual([]);
    expect(source).not.toMatch(/\bfetch\(|GST_VERIFICATION_API_KEY|x-api-key|www\.gstinapi\.in/);
  });
  it('the review snapshot runs in a READ ONLY transaction', () => {
    expect(read('gst-verification-reconciliation.ts')).toContain('SET TRANSACTION READ ONLY');
  });
});
