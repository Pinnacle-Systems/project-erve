// Operator tooling for GSTINAPI verification claims that stay held after an
// uncertain provider outcome or an interrupted execution (see
// gstin-verification.repository.ts: `fail(..., uncertain)` keeps the claim and
// nothing ever releases it automatically).
//
// Two CLIs share this module:
//   - gst-verification-review.cli.ts      read-only inspection
//   - gst-verification-reconcile.cli.ts   audited, one-operation-at-a-time decision
//
// Hard boundaries, all enforced by tests:
//   - never imports or calls the GSTINAPI provider (no network of any kind);
//   - never changes an operation's historical `outcome` or evidence;
//   - the only claim-state change is deleting ONE claim for a NOT_CHARGED decision,
//     in the same transaction as the audit row that justifies it.
// Releasing a claim is NOT proof the provider did not charge credits: the evidence
// reference is the operator's attestation and is never fetched or verified here.
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { prisma, type Prisma } from '../db/prisma.js';
import { recordAuditLog } from '../audit/audit.service.js';

export class GstReconciliationError extends Error {}

/**
 * Same lock name `claim()` takes in gstin-verification.repository.ts. It is
 * duplicated rather than imported so the verification lifecycle file stays
 * untouched; a source-level test pins the two literals together.
 */
export const GST_EXECUTION_ADVISORY_LOCK = 'gst-verification-execution';
export const HELD_OUTCOMES = ['DISPATCHED', 'UNCERTAIN'] as const;
/** Provider timeout is bounded to 30s; this is the floor before a DISPATCHED claim may be investigated. */
export const DISPATCHED_MIN_AGE_MINUTES = 15;
export const AUDIT_ENTITY_TYPE = 'GstVerificationOperation';
export const AUDIT_ACTION_RELEASED = 'GST_VERIFICATION_CLAIM_RELEASED';
export const AUDIT_ACTION_REVIEWED = 'GST_VERIFICATION_CLAIM_REVIEWED';
export const AUTHORIZED_OPERATOR_ROLES = ['ACCOUNTANT', 'ADMIN'] as const;
export const DECISIONS = ['NOT_CHARGED', 'CHARGED_NO_RESULT', 'UNKNOWN', 'IN_PROGRESS'] as const;
export type ReconcileDecision = (typeof DECISIONS)[number];
export const PROVIDER_EVIDENCE_TYPES = [
  'PROVIDER_DASHBOARD_LEDGER',
  'PROVIDER_SUPPORT_CONFIRMATION',
  'PROVIDER_INVOICE_STATEMENT',
] as const;
export const DEMO_SAMPLE_EVIDENCE_TYPE = 'DEMO_SAMPLE_IDENTITY';
export type EvidenceType =
  (typeof PROVIDER_EVIDENCE_TYPES)[number] | typeof DEMO_SAMPLE_EVIDENCE_TYPE;
const AUDIT_SOURCE = 'gst-verification-reconcile-cli';

export function maskGstin(gstin: string): string {
  return gstin.length < 6
    ? '***'
    : `${gstin.slice(0, 2)}${'*'.repeat(gstin.length - 5)}${gstin.slice(-3)}`;
}
export function claimKeyFor(op: { mode: string; normalizedGstin: string; level: string }): string {
  return `${op.mode}:${op.normalizedGstin}:${op.level}`;
}
export function maskClaimKey(op: { mode: string; normalizedGstin: string; level: string }): string {
  return `${op.mode}:${maskGstin(op.normalizedGstin)}:${op.level}`;
}
/** Short, non-reversible handle an operator copies from the review output to bind a decision to one exact claim. */
export function claimFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}
const minutesBetween = (later: Date, earlier: Date) =>
  Math.floor((later.getTime() - earlier.getTime()) / 60_000);

// ---------------------------------------------------------------------------
// Read-only review
// ---------------------------------------------------------------------------

export interface ReviewRow {
  operationId: string;
  mode: string;
  level: string;
  maskedGstin: string;
  outcome: string;
  failureCode: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  reviewAfter: string | null;
  claimAgeMinutes: number | null;
  lastReviewedAt: string | null;
  lastDecision: string | null;
  reviewCount: number;
  evidenceStatus: 'NONE' | 'PRESENT';
  claimFingerprint: string | null;
  flags: string[];
  readiness: string;
}
export interface ReviewSnapshot {
  generatedAt: string;
  totalOperations: number;
  outcomeCounts: Array<{ mode: string; outcome: string; count: number }>;
  activeClaims: number;
  held: ReviewRow[];
  anomalies: ReviewRow[];
  released: ReviewRow[];
}

type OperationWithRelations = Prisma.GstVerificationOperationGetPayload<{
  include: { claim: true; evidence: { select: { id: true } } };
}>;
type AuditRow = { entityId: string; action: string; createdAt: Date; metadata: Prisma.JsonValue };

function lastDecisionOf(audit: AuditRow | undefined): string | null {
  const metadata = audit?.metadata;
  return metadata &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata) &&
    typeof metadata.decision === 'string'
    ? metadata.decision
    : null;
}

/**
 * The single definition of an anomalous held operation. The review reports these
 * and the reconcile command refuses every decision on them (audit-only ones too):
 * their recorded state contradicts itself, so no decision could be truthfully audited.
 */
export function operationAnomalyFlags(
  op: OperationWithRelations,
  releasedBefore: boolean,
): string[] {
  const claim = op.claim;
  const flags: string[] = [];
  const held = (HELD_OUTCOMES as readonly string[]).includes(op.outcome);
  if (claim && !held) flags.push('CLAIM_ON_NON_HELD_OUTCOME');
  if (claim && claim.key !== claimKeyFor(op)) flags.push('CLAIM_KEY_MISMATCH');
  if (held && op.evidence) flags.push('EVIDENCE_PRESENT_ON_HELD_OPERATION');
  if (held && !claim && !releasedBefore) flags.push('HELD_OUTCOME_WITHOUT_CLAIM');
  if (op.outcome === 'UNCERTAIN' && !op.completedAt)
    flags.push('UNCERTAIN_WITHOUT_COMPLETION_TIME');
  if (op.outcome === 'DISPATCHED' && !op.dispatchedAt)
    flags.push('DISPATCHED_WITHOUT_DISPATCH_TIME');
  return flags;
}

const ANOMALY_DESCRIPTIONS: Record<string, string> = {
  EVIDENCE_PRESENT_ON_HELD_OPERATION: 'evidence already exists for this operation',
  UNCERTAIN_WITHOUT_COMPLETION_TIME: 'an UNCERTAIN operation has no completion time',
  DISPATCHED_WITHOUT_DISPATCH_TIME: 'a DISPATCHED operation has no dispatch time',
  HELD_OUTCOME_WITHOUT_CLAIM: 'the operation holds no claim and was never released here',
  CLAIM_KEY_MISMATCH: 'the claim key does not match the operation identity',
  CLAIM_ON_NON_HELD_OUTCOME:
    'a claim is held by an operation that is neither DISPATCHED nor UNCERTAIN',
};

function buildRow(op: OperationWithRelations, audits: AuditRow[], now: Date): ReviewRow {
  const claim = op.claim;
  const flags = operationAnomalyFlags(
    op,
    audits.some((a) => a.action === AUDIT_ACTION_RELEASED),
  );
  const age = claim && op.dispatchedAt ? minutesBetween(now, op.dispatchedAt) : null;
  const last = audits[0];
  let readiness: string;
  if (flags.length > 0)
    readiness = `Blocked: anomaly (${flags.join(', ')}) - investigate manually, no release path`;
  else if (!claim) readiness = 'Resolved: claim already released';
  else if (op.outcome === 'UNCERTAIN') readiness = 'Eligible for provider-evidence review';
  else if (age !== null && age < DISPATCHED_MIN_AGE_MINUTES)
    readiness = `Not yet eligible: DISPATCHED ${age} min (minimum ${DISPATCHED_MIN_AGE_MINUTES}); may still be executing`;
  else
    readiness =
      'Eligible for investigation; release also needs a documented no-active-worker assessment';
  return {
    operationId: op.id,
    mode: op.mode,
    level: op.level,
    maskedGstin: maskGstin(op.normalizedGstin),
    outcome: op.outcome,
    failureCode: op.failureCode,
    createdAt: op.createdAt.toISOString(),
    dispatchedAt: op.dispatchedAt?.toISOString() ?? null,
    completedAt: op.completedAt?.toISOString() ?? null,
    reviewAfter: claim?.reviewAfter.toISOString() ?? null,
    claimAgeMinutes: age,
    lastReviewedAt: last?.createdAt.toISOString() ?? null,
    lastDecision: lastDecisionOf(last),
    reviewCount: audits.length,
    evidenceStatus: op.evidence ? 'PRESENT' : 'NONE',
    claimFingerprint: claim ? claimFingerprint(claim.key) : null,
    flags,
    readiness,
  };
}

/** One consistent snapshot; the transaction is READ ONLY so the database itself rejects any write. */
export async function loadReviewSnapshot(
  options: { operationId?: string; now?: Date } = {},
): Promise<ReviewSnapshot> {
  const now = options.now ?? new Date();
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [grouped, activeClaims] = await Promise.all([
        tx.gstVerificationOperation.groupBy({ by: ['mode', 'outcome'], _count: { _all: true } }),
        tx.gstVerificationClaim.count(),
      ]);
      const include = { claim: true, evidence: { select: { id: true } } } as const;
      const [heldOps, strayClaimOps] = await Promise.all([
        tx.gstVerificationOperation.findMany({
          where: {
            outcome: { in: [...HELD_OUTCOMES] },
            ...(options.operationId ? { id: options.operationId } : {}),
          },
          include,
          orderBy: [{ dispatchedAt: 'asc' }, { id: 'asc' }],
        }),
        tx.gstVerificationOperation.findMany({
          where: {
            outcome: { notIn: [...HELD_OUTCOMES] },
            claim: { isNot: null },
            ...(options.operationId ? { id: options.operationId } : {}),
          },
          include,
          orderBy: { id: 'asc' },
        }),
      ]);
      const ops = [...heldOps, ...strayClaimOps];
      const auditRows = ops.length
        ? await tx.auditLog.findMany({
            where: {
              entityType: AUDIT_ENTITY_TYPE,
              entityId: { in: ops.map((op) => op.id) },
              action: { in: [AUDIT_ACTION_RELEASED, AUDIT_ACTION_REVIEWED] },
            },
            select: { entityId: true, action: true, createdAt: true, metadata: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : [];
      const rows = ops.map((op) =>
        buildRow(
          op,
          auditRows.filter((a) => a.entityId === op.id),
          now,
        ),
      );
      return {
        generatedAt: now.toISOString(),
        totalOperations: grouped.reduce((sum, g) => sum + g._count._all, 0),
        outcomeCounts: grouped
          .map((g) => ({ mode: g.mode, outcome: g.outcome, count: g._count._all }))
          .sort((a, b) => a.mode.localeCompare(b.mode) || a.outcome.localeCompare(b.outcome)),
        activeClaims,
        held: rows.filter((r) => r.flags.length === 0 && r.claimFingerprint !== null),
        anomalies: rows.filter((r) => r.flags.length > 0),
        released: rows.filter((r) => r.flags.length === 0 && r.claimFingerprint === null),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  );
}

function renderRow(row: ReviewRow): string[] {
  return [
    `  Operation ID:    ${row.operationId}`,
    `  Mode / Level:    ${row.mode} / ${row.level}    GSTIN: ${row.maskedGstin}`,
    `  Outcome:         ${row.outcome}${row.failureCode ? ` (failure ${row.failureCode})` : ''}`,
    `  Created:         ${row.createdAt}`,
    `  Dispatched:      ${row.dispatchedAt ?? '-'}    Completed: ${row.completedAt ?? '-'}`,
    `  Claim:           fingerprint ${row.claimFingerprint ?? '-'}    age ${row.claimAgeMinutes ?? '-'} min    reviewAfter ${row.reviewAfter ?? '-'} (informational only)`,
    `  Evidence row:    ${row.evidenceStatus}`,
    `  Last review:     ${row.lastReviewedAt ? `${row.lastReviewedAt} (${row.lastDecision ?? 'unknown decision'}, ${row.reviewCount} total)` : 'never'}`,
    `  Readiness:       ${row.readiness}`,
  ];
}

export function formatReviewReport(
  snapshot: ReviewSnapshot,
  options: { details?: boolean } = {},
): string {
  const lines = [
    '======================================================================',
    'ERVE India - GST Verification Claim Review (READ ONLY)',
    '======================================================================',
    `Generated: ${snapshot.generatedAt}`,
    `Total operations: ${snapshot.totalOperations}    Active verification claims: ${snapshot.activeClaims}`,
    '',
    'Operations by mode and outcome:',
    ...(snapshot.outcomeCounts.length
      ? snapshot.outcomeCounts.map(
          (c) => `  ${c.mode.padEnd(5)} ${c.outcome.padEnd(11)} ${c.count}`,
        )
      : ['  (none)']),
    '',
    `Held operations requiring investigation: ${snapshot.held.length}`,
  ];
  for (const row of snapshot.held) lines.push('', ...renderRow(row));
  if (snapshot.anomalies.length) {
    lines.push('', `ANOMALIES (cannot be reconciled with this tool): ${snapshot.anomalies.length}`);
    for (const row of snapshot.anomalies) lines.push('', ...renderRow(row));
  }
  lines.push('', `Previously released through reconciliation: ${snapshot.released.length}`);
  if (options.details) for (const row of snapshot.released) lines.push('', ...renderRow(row));
  lines.push(
    '',
    'Notes: GSTINs are masked. This command made no provider request and changed no data.',
    'A released claim is NOT proof that the provider did not charge credits.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Argument parsing (strict: unknown flags are rejected, never ignored)
// ---------------------------------------------------------------------------

const SHARED_OPTIONS = {
  target: { type: 'string' },
  'expect-database': { type: 'string' },
  'expect-schema': { type: 'string' },
  'expect-host': { type: 'string' },
  'env-file': { type: 'string' },
  'operation-id': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

function strictParse<T extends Record<string, { type: 'string' | 'boolean'; short?: string }>>(
  argv: string[],
  options: T,
) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/acknowledge-duplicate-charge/.test(message))
      throw new GstReconciliationError(
        '--acknowledge-duplicate-charge is not supported: CHARGED_NO_RESULT never releases a claim. ' +
          'Releasing it requires separately authorized duplicate-charge handling.',
      );
    throw new GstReconciliationError(message);
  }
}

export interface ReviewArgs {
  target?: string;
  expectDatabase?: string;
  expectSchema?: string;
  expectHost?: string;
  envFile?: string;
  operationId?: string;
  details: boolean;
}
export function parseReviewArgs(argv: string[]): ReviewArgs {
  const v = strictParse(argv, { ...SHARED_OPTIONS, details: { type: 'boolean' } });
  return {
    target: v.target,
    expectDatabase: v['expect-database'],
    expectSchema: v['expect-schema'],
    expectHost: v['expect-host'],
    envFile: v['env-file'],
    operationId: v['operation-id'],
    details: v.details ?? false,
  };
}

export interface ReconcileInput {
  operationId: string;
  claimFingerprint: string;
  expectOutcome: (typeof HELD_OUTCOMES)[number];
  decision: ReconcileDecision;
  operatorEmail: string;
  reason: string;
  evidenceType?: EvidenceType;
  evidenceRef?: string;
  evidenceWindowStart?: Date;
  evidenceWindowEnd?: Date;
  chargedCredits?: number;
  noActiveWorkerAssessment?: string;
  confirmDemoSample: boolean;
  dryRun: boolean;
}
export interface ReconcileArgs {
  target?: string;
  expectDatabase?: string;
  expectSchema?: string;
  expectHost?: string;
  envFile?: string;
  confirmProduction: boolean;
  input: ReconcileInput;
}

const text = (value: string | undefined) => value?.trim() || undefined;
function parseDate(flag: string, value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(parsed.getTime()))
    throw new GstReconciliationError(
      `${flag} must be an ISO-8601 timestamp, e.g. 2026-11-02T10:15:00Z`,
    );
  return parsed;
}

const GSTIN_SHAPE = /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/i;
const UUID_SHAPE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CREDENTIAL_SHAPES = [
  /(api[-_ ]?key|apikey|secret|passw(?:or)?d|pwd|passphrase|token|bearer|authorization|credential)s?\s*[:=]/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
  /\b(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
];

/**
 * Operator text is persisted in the audit trail, so it must not carry secrets or a
 * complete GSTIN (the audit trail only ever holds masked GSTINs). The matched text is
 * never echoed: a rejected value must not reach the terminal, shell history logs or CI output.
 */
export function findSensitiveContent(value: string): 'GSTIN' | 'CREDENTIAL' | null {
  const compact = value.replace(/[\s._-]/g, '');
  if (GSTIN_SHAPE.test(compact)) return 'GSTIN';
  if (CREDENTIAL_SHAPES.some((shape) => shape.test(value))) return 'CREDENTIAL';
  const withoutIds = value.replace(UUID_SHAPE, ' ');
  for (const [candidate] of withoutIds.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    const hasLetter = /[A-Za-z]/.test(candidate);
    const hasDigit = /\d/.test(candidate);
    const separated = /[-_]/.test(candidate);
    // Hex/base64 blobs, or base64url with mixed case; hyphenated ticket ids stay allowed.
    if (
      hasLetter &&
      hasDigit &&
      (!separated || (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate) && candidate.length >= 40))
    )
      return 'CREDENTIAL';
  }
  return null;
}
function assertNoSensitiveText(flag: string, value: string | undefined): void {
  if (!value) return;
  const found = findSensitiveContent(value);
  if (found === 'GSTIN')
    throw new GstReconciliationError(
      `${flag} appears to contain a complete GSTIN; cite the operation id or the masked GSTIN instead`,
    );
  if (found === 'CREDENTIAL')
    throw new GstReconciliationError(
      `${flag} appears to contain credential-like content; cite a ticket or ledger identifier instead`,
    );
}

/** Pure validation of everything that does not need the database. */
export function parseReconcileArgs(argv: string[]): ReconcileArgs {
  const v = strictParse(argv, {
    ...SHARED_OPTIONS,
    'confirm-production': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'claim-fingerprint': { type: 'string' },
    'expect-outcome': { type: 'string' },
    decision: { type: 'string' },
    'operator-email': { type: 'string' },
    'evidence-type': { type: 'string' },
    'evidence-ref': { type: 'string' },
    'evidence-window-start': { type: 'string' },
    'evidence-window-end': { type: 'string' },
    'charged-credits': { type: 'string' },
    reason: { type: 'string' },
    'no-active-worker-assessment': { type: 'string' },
    'confirm-demo-sample': { type: 'boolean' },
  });
  const need = (flag: string, value: string | undefined) => {
    const t = text(value);
    if (!t) throw new GstReconciliationError(`${flag} is required`);
    return t;
  };
  const operationId = need('--operation-id', v['operation-id']);
  const fingerprint = need('--claim-fingerprint', v['claim-fingerprint']).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(fingerprint))
    throw new GstReconciliationError(
      '--claim-fingerprint must be the 8-hex-character value shown by gst-verification-review',
    );
  const expectOutcome = need('--expect-outcome', v['expect-outcome']);
  if (!(HELD_OUTCOMES as readonly string[]).includes(expectOutcome))
    throw new GstReconciliationError(
      `--expect-outcome must be one of: ${HELD_OUTCOMES.join(', ')}`,
    );
  const decision = need('--decision', v.decision);
  if (!(DECISIONS as readonly string[]).includes(decision))
    throw new GstReconciliationError(`--decision must be one of: ${DECISIONS.join(', ')}`);
  const reason = need('--reason', v.reason);
  if (reason.length < 10 || reason.length > 1000)
    throw new GstReconciliationError(
      '--reason must be 10-1000 characters and document why this decision was reached',
    );
  const operatorEmail = need('--operator-email', v['operator-email']).toLowerCase();

  const evidenceTypeRaw = text(v['evidence-type']);
  const allowedTypes = [...PROVIDER_EVIDENCE_TYPES, DEMO_SAMPLE_EVIDENCE_TYPE] as string[];
  if (evidenceTypeRaw && !allowedTypes.includes(evidenceTypeRaw))
    throw new GstReconciliationError(
      `--evidence-type must be one of: ${allowedTypes.join(', ')}. ` +
        'Daily aggregate usage (stats/me, credits_remaining, credits_used) is not evidence for a specific request.',
    );
  const evidenceRef = text(v['evidence-ref']);
  if (evidenceRef) {
    if (
      evidenceRef.length < 8 ||
      evidenceRef.length > 500 ||
      [...evidenceRef].some((ch) => ch.charCodeAt(0) < 32)
    )
      throw new GstReconciliationError('--evidence-ref must be 8-500 printable characters');
  }
  if (evidenceTypeRaw && !evidenceRef)
    throw new GstReconciliationError('--evidence-type requires --evidence-ref');
  if (evidenceRef && !evidenceTypeRaw)
    throw new GstReconciliationError('--evidence-ref requires --evidence-type');

  const chargedRaw = text(v['charged-credits']);
  const chargedCredits = chargedRaw === undefined ? undefined : Number(chargedRaw);
  if (chargedCredits !== undefined && (!Number.isFinite(chargedCredits) || chargedCredits <= 0))
    throw new GstReconciliationError('--charged-credits must be a positive number');

  const assessment = text(v['no-active-worker-assessment']);
  if (assessment && (assessment.length < 20 || assessment.length > 1000))
    throw new GstReconciliationError('--no-active-worker-assessment must be 20-1000 characters');

  const input: ReconcileInput = {
    operationId,
    claimFingerprint: fingerprint,
    expectOutcome: expectOutcome as ReconcileInput['expectOutcome'],
    decision: decision as ReconcileDecision,
    operatorEmail,
    reason,
    evidenceType: evidenceTypeRaw as EvidenceType | undefined,
    evidenceRef,
    evidenceWindowStart: parseDate('--evidence-window-start', text(v['evidence-window-start'])),
    evidenceWindowEnd: parseDate('--evidence-window-end', text(v['evidence-window-end'])),
    chargedCredits,
    noActiveWorkerAssessment: assessment,
    confirmDemoSample: v['confirm-demo-sample'] ?? false,
    dryRun: v['dry-run'] ?? false,
  };
  if (!v['expect-database']?.trim())
    throw new GstReconciliationError(
      '--expect-database is required (explicit expected database identity)',
    );
  assertDecisionInputs(input);
  return {
    target: v.target,
    expectDatabase: v['expect-database'],
    expectSchema: v['expect-schema'],
    expectHost: v['expect-host'],
    envFile: v['env-file'],
    confirmProduction: v['confirm-production'] ?? false,
    input,
  };
}

/** Decision-level rules that depend only on the arguments. Mode-dependent rules run under the lock. */
function assertDecisionInputs(input: ReconcileInput): void {
  const fail: (message: string) => never = (message) => {
    throw new GstReconciliationError(message);
  };
  // Every operator-supplied string that is persisted in the audit metadata.
  assertNoSensitiveText('--reason', input.reason);
  assertNoSensitiveText('--evidence-ref', input.evidenceRef);
  assertNoSensitiveText('--no-active-worker-assessment', input.noActiveWorkerAssessment);
  if (input.chargedCredits !== undefined && input.decision !== 'CHARGED_NO_RESULT')
    fail('--charged-credits only applies to --decision CHARGED_NO_RESULT');
  if (input.noActiveWorkerAssessment && input.decision !== 'NOT_CHARGED')
    fail('--no-active-worker-assessment only applies to --decision NOT_CHARGED');
  if (input.confirmDemoSample && input.evidenceType !== DEMO_SAMPLE_EVIDENCE_TYPE)
    fail(`--confirm-demo-sample only applies to --evidence-type ${DEMO_SAMPLE_EVIDENCE_TYPE}`);
  if (input.decision === 'NOT_CHARGED' || input.decision === 'CHARGED_NO_RESULT') {
    if (!input.evidenceType || !input.evidenceRef)
      fail(
        `--decision ${input.decision} requires --evidence-type and --evidence-ref (operation-specific provider evidence)`,
      );
  }
  if (input.decision === 'CHARGED_NO_RESULT') {
    if (input.evidenceType === DEMO_SAMPLE_EVIDENCE_TYPE)
      fail('CHARGED_NO_RESULT needs provider charge evidence, not a Demo sample classification');
    if (input.chargedCredits === undefined) fail('CHARGED_NO_RESULT requires --charged-credits');
  }
  if (input.decision === 'NOT_CHARGED' && input.evidenceType === DEMO_SAMPLE_EVIDENCE_TYPE) {
    if (!input.confirmDemoSample)
      fail(`--evidence-type ${DEMO_SAMPLE_EVIDENCE_TYPE} requires --confirm-demo-sample`);
  } else if (input.decision === 'NOT_CHARGED') {
    if (!input.evidenceWindowStart || !input.evidenceWindowEnd)
      fail(
        'NOT_CHARGED requires --evidence-window-start and --evidence-window-end: the provider-record window you reviewed',
      );
    else if (input.evidenceWindowStart >= input.evidenceWindowEnd)
      fail('--evidence-window-start must be before --evidence-window-end');
  }
  if (
    (input.decision === 'UNKNOWN' || input.decision === 'IN_PROGRESS') &&
    input.evidenceType === DEMO_SAMPLE_EVIDENCE_TYPE
  )
    fail('A Demo sample classification can only support a NOT_CHARGED decision');
}

// ---------------------------------------------------------------------------
// Reconciliation (single transaction)
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  operationId: string;
  decision: ReconcileDecision;
  previousOutcome: string;
  claimDisposition: 'RELEASED' | 'RETAINED';
  dryRun: boolean;
  auditAction: string | null;
  note: string;
}

export async function reconcileGstVerificationClaim(
  input: ReconcileInput,
  options: { now?: () => Date } = {},
): Promise<ReconcileResult> {
  const clock = options.now ?? (() => new Date());
  assertDecisionInputs(input);
  return prisma.$transaction(
    async (tx) => {
      const refuse: (message: string) => never = (message) => {
        throw new GstReconciliationError(`Refusing: ${message}`);
      };
      // Same advisory lock as claim acquisition: no verification can acquire (or
      // contend for) a claim while this decision is evaluated and applied.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${GST_EXECUTION_ADVISORY_LOCK}))`;
      // complete()/fail() do not take the advisory lock; the row lock makes a
      // concurrent completion either finish before we re-read or wait for us.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM gst_verification_operations WHERE id = ${input.operationId} FOR UPDATE`;
      if (locked.length === 0) refuse(`operation ${input.operationId} does not exist`);
      const now = clock();

      const op = await tx.gstVerificationOperation.findUniqueOrThrow({
        where: { id: input.operationId },
        include: { claim: true, evidence: { select: { id: true } } },
      });
      const operators = await tx.user.findMany({
        where: { email: { equals: input.operatorEmail, mode: 'insensitive' } },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          userRoles: { select: { role: { select: { name: true } } } },
        },
        take: 2,
      });
      if (operators.length > 1)
        refuse('--operator-email matches more than one user; attribution would be ambiguous');
      const operator = operators[0];
      if (!operator) refuse('--operator-email does not match an existing user');
      if (operator.status !== 'ACTIVE') refuse('the operator user is not ACTIVE');
      if (
        !operator.userRoles.some((ur) =>
          (AUTHORIZED_OPERATOR_ROLES as readonly string[]).includes(ur.role.name),
        )
      )
        refuse(`the operator must hold one of the roles: ${AUTHORIZED_OPERATOR_ROLES.join(', ')}`);

      if (!(HELD_OUTCOMES as readonly string[]).includes(op.outcome))
        refuse(
          `operation outcome is ${op.outcome}; only ${HELD_OUTCOMES.join(' or ')} operations holding a claim are reconcilable`,
        );
      if (op.outcome !== input.expectOutcome)
        refuse(
          `operation outcome is now ${op.outcome}, not the expected ${input.expectOutcome}; re-run the review`,
        );
      const claim = op.claim;
      if (!claim) refuse('the operation holds no claim (already released, or never claimed)');
      const key = claimKeyFor(op);
      if (claim.operationId !== op.id || claim.key !== key)
        refuse(
          'the claim key does not match the operation identity; this is an anomaly to investigate manually',
        );
      if (claimFingerprint(claim.key) !== input.claimFingerprint)
        refuse("--claim-fingerprint does not match this operation's claim; re-run the review");

      // Anomalous state (for example an evidence row on a held operation) is refused for
      // EVERY decision, audit-only ones included: a review entry would otherwise assert a
      // state the database contradicts. The review lists these operations as anomalies.
      const releasedBefore =
        (await tx.auditLog.count({
          where: { entityType: AUDIT_ENTITY_TYPE, entityId: op.id, action: AUDIT_ACTION_RELEASED },
        })) > 0;
      const anomalyFlags = operationAnomalyFlags(op, releasedBefore);
      if (anomalyFlags.length > 0)
        refuse(
          `${anomalyFlags.map((flag) => ANOMALY_DESCRIPTIONS[flag] ?? flag).join('; ')}; ` +
            `the recorded state is anomalous (${anomalyFlags.join(', ')}) and cannot be reconciled with this tool - investigate manually`,
        );

      const releases = input.decision === 'NOT_CHARGED';
      const completed = op.completedAt;
      const dispatched = op.dispatchedAt;
      const claimAgeMinutes = dispatched ? minutesBetween(now, dispatched) : null;
      if (releases) {
        if (releasedBefore)
          refuse('this operation was already released by a previous reconciliation');
        if (!dispatched) refuse('the operation has no dispatch time; cannot assess it');
        if (op.outcome === 'DISPATCHED') {
          const age = minutesBetween(now, dispatched);
          if (age < DISPATCHED_MIN_AGE_MINUTES)
            refuse(
              `DISPATCHED for ${age} min; it may still be executing (minimum ${DISPATCHED_MIN_AGE_MINUTES} min)`,
            );
          if (!input.noActiveWorkerAssessment)
            refuse(
              'releasing a DISPATCHED claim requires --no-active-worker-assessment documenting that no worker can still be executing it',
            );
        }
        if (input.evidenceType === DEMO_SAMPLE_EVIDENCE_TYPE) {
          if (op.mode !== 'DEMO')
            refuse('Demo sample evidence can never justify releasing a Live claim');
          if (op.estimatedCredits !== 0)
            refuse(
              'the operation carries a non-zero credit estimate; it is not a free Demo sample operation',
            );
        } else {
          const { evidenceWindowStart: windowStart, evidenceWindowEnd: windowEnd } = input;
          if (!windowStart || !windowEnd)
            refuse('NOT_CHARGED requires the reviewed evidence window');
          const coverEnd = new Date(
            Math.max((completed ?? dispatched).getTime(), dispatched.getTime() + 60_000),
          );
          if (windowStart > dispatched || windowEnd < coverEnd)
            refuse(
              `the reviewed evidence window must cover ${dispatched.toISOString()} to ${coverEnd.toISOString()} ` +
                'so the provider record is specific to this operation',
            );
          if (windowEnd.getTime() > now.getTime() + 60_000)
            refuse('--evidence-window-end is in the future');
        }
      }

      const claimDisposition = releases ? 'RELEASED' : 'RETAINED';
      const note =
        input.decision === 'CHARGED_NO_RESULT'
          ? 'Claim RETAINED. A charge without a usable result needs separately authorized duplicate-charge handling before any release.'
          : input.decision === 'NOT_CHARGED'
            ? 'Claim RELEASED. This is not proof the provider did not charge; the operation outcome is unchanged and no retry was started.'
            : `Claim RETAINED (${input.decision}). Audit entry only.`;
      if (input.dryRun)
        return {
          operationId: op.id,
          decision: input.decision,
          previousOutcome: op.outcome,
          claimDisposition,
          dryRun: true,
          auditAction: null,
          note: `[DRY RUN] All checks passed; nothing written. Would have: ${note}`,
        };

      const auditAction = await writeAuditThenApply(tx, {
        input,
        op,
        operator,
        claimKeyFingerprint: claimFingerprint(claim.key),
        claimDisposition,
        claimAgeMinutes,
        now,
        // Recorded exactly as observed under the locks, never asserted as constants.
        checks: {
          advisoryLockHeld: true, // the lock statement above completed without error
          operationRowLocked: locked.length === 1,
          evidenceRowPresent: op.evidence !== null,
          claimKeyMatchedOperation: claim.operationId === op.id && claim.key === key,
          fingerprintMatched: claimFingerprint(claim.key) === input.claimFingerprint,
          outcomeMatchedExpectation: op.outcome === input.expectOutcome,
          anomalyFlags,
        },
      });
      return {
        operationId: op.id,
        decision: input.decision,
        previousOutcome: op.outcome,
        claimDisposition,
        dryRun: false,
        auditAction,
        note,
      };
    },
    { isolationLevel: 'ReadCommitted', maxWait: 30_000, timeout: 60_000 },
  );
}

async function writeAuditThenApply(
  tx: Prisma.TransactionClient,
  ctx: {
    input: ReconcileInput;
    op: OperationWithRelations;
    operator: { id: string; email: string; name: string };
    claimKeyFingerprint: string;
    claimDisposition: 'RELEASED' | 'RETAINED';
    claimAgeMinutes: number | null;
    now: Date;
    checks: {
      advisoryLockHeld: boolean;
      operationRowLocked: boolean;
      evidenceRowPresent: boolean;
      claimKeyMatchedOperation: boolean;
      fingerprintMatched: boolean;
      outcomeMatchedExpectation: boolean;
      anomalyFlags: string[];
    };
  },
): Promise<string> {
  const { input, op, operator } = ctx;
  const metadata: Prisma.InputJsonObject = {
    source: AUDIT_SOURCE,
    operationId: op.id,
    decision: input.decision,
    claimDisposition: ctx.claimDisposition,
    previousOutcome: op.outcome,
    failureCode: op.failureCode,
    mode: op.mode,
    level: op.level,
    claimKeyMasked: maskClaimKey(op),
    claimFingerprint: ctx.claimKeyFingerprint,
    operatorId: operator.id,
    operatorEmail: operator.email,
    operatorName: operator.name,
    reason: input.reason,
    evidenceType: input.evidenceType ?? null,
    evidenceRef: input.evidenceRef ?? null,
    evidenceWindowStart: input.evidenceWindowStart?.toISOString() ?? null,
    evidenceWindowEnd: input.evidenceWindowEnd?.toISOString() ?? null,
    chargedCredits: input.chargedCredits ?? null,
    noActiveWorkerAssessment: input.noActiveWorkerAssessment ?? null,
    demoSampleConfirmed: input.confirmDemoSample,
    reviewedAt: ctx.now.toISOString(),
    eligibility: {
      dispatchedAt: op.dispatchedAt?.toISOString() ?? null,
      completedAt: op.completedAt?.toISOString() ?? null,
      claimAgeMinutes: ctx.claimAgeMinutes,
      dispatchedMinAgeMinutes: DISPATCHED_MIN_AGE_MINUTES,
      ...ctx.checks,
    },
    possibleDuplicateCharge: input.decision === 'CHARGED_NO_RESULT' ? true : null,
  };
  const releases = ctx.claimDisposition === 'RELEASED';
  // Append-only: the audit row is inserted before the claim changes, in the same
  // transaction. If the insert throws, the transaction rolls back and the claim is untouched.
  const action = releases ? AUDIT_ACTION_RELEASED : AUDIT_ACTION_REVIEWED;
  await recordAuditLog(
    { actorId: operator.id, action, entityType: AUDIT_ENTITY_TYPE, entityId: op.id, metadata },
    tx,
  );
  if (releases) {
    const deleted = await tx.gstVerificationClaim.deleteMany({
      where: { operationId: op.id, key: claimKeyFor(op) },
    });
    if (deleted.count !== 1)
      throw new GstReconciliationError(
        'Refusing: the claim changed during release; transaction rolled back',
      );
  }
  return action;
}
