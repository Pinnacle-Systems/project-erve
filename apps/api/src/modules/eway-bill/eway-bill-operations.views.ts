import type {
  EwayBillAttemptOutcome,
  EwayBillAttemptView,
  EwayBillRecordView,
} from '@erve/types';

// Pure row -> read-model mappers, shared by the Prisma repository and tests.
// They expose only what a reader needs: never the request fingerprint, the
// payload, a provider response body or any credential.

/** PREPARED / DISPATCHED / UNCERTAIN: blocks another request for the same invoice and mode. */
export const OPEN_ATTEMPT_OUTCOMES: readonly EwayBillAttemptOutcome[] = [
  'PREPARED',
  'DISPATCHED',
  'UNCERTAIN',
];

export const isOpenAttempt = (outcome: EwayBillAttemptOutcome): boolean =>
  OPEN_ATTEMPT_OUTCOMES.includes(outcome);

/**
 * An open attempt needs a person when its outcome is unknown (UNCERTAIN) or
 * when it has sat in PREPARED / DISPATCHED past its review time (a crash or a
 * stalled request). This flags it for review ONLY: elapsed time never closes
 * or releases an attempt.
 */
export function attemptRequiresReview(
  outcome: EwayBillAttemptOutcome,
  reviewAfter: Date | null,
  now: Date,
): boolean {
  if (!isOpenAttempt(outcome)) return false;
  if (outcome === 'UNCERTAIN') return true;
  return reviewAfter !== null && reviewAfter.getTime() <= now.getTime();
}

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const toDay = (value: Date): string => value.toISOString().slice(0, 10);

export interface AttemptRow {
  id: string;
  integrationMode: 'DEMO' | 'LIVE';
  outcome: EwayBillAttemptOutcome;
  actor: { id: string; name: string };
  documentType: string;
  documentNumber: string;
  documentDate: Date;
  settingsVersion: number;
  movementVersion: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  reviewAfter: Date | null;
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
  ewayBill: { id: string } | null;
}

export function toAttemptView(row: AttemptRow, now: Date): EwayBillAttemptView {
  return {
    id: row.id,
    integrationMode: row.integrationMode,
    outcome: row.outcome,
    open: isOpenAttempt(row.outcome),
    requiresReview: attemptRequiresReview(row.outcome, row.reviewAfter, now),
    actor: row.actor,
    document: { type: row.documentType, number: row.documentNumber, date: toDay(row.documentDate) },
    settingsVersion: row.settingsVersion,
    movementVersion: row.movementVersion,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    dispatchedAt: toIso(row.dispatchedAt),
    completedAt: toIso(row.completedAt),
    reviewAfter: toIso(row.reviewAfter),
    resolution:
      row.resolvedBy && row.resolvedAt && row.resolutionReason
        ? { by: row.resolvedBy, at: row.resolvedAt.toISOString(), reason: row.resolutionReason }
        : null,
    ewayBillId: row.ewayBill?.id ?? null,
  };
}

export interface BillRow {
  id: string;
  source: 'PROVIDER_GENERATED' | 'EXTERNALLY_LINKED';
  status: 'ACTIVE' | 'CANCELLED';
  integrationMode: 'DEMO' | 'LIVE';
  verificationStatus: 'SYNTHETIC_DEMO' | 'UNVERIFIED_REFERENCE' | 'PROVIDER_VERIFIED';
  verifiedAt: Date | null;
  ewayBillNumber: string;
  generatedAt: Date | null;
  validUntil: Date | null;
  requestAttemptId: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
}

export function toBillView(row: BillRow): EwayBillRecordView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    integrationMode: row.integrationMode,
    verificationStatus: row.verificationStatus,
    verifiedAt: toIso(row.verifiedAt),
    ewayBillNumber: row.ewayBillNumber,
    generatedAt: toIso(row.generatedAt),
    validUntil: toIso(row.validUntil),
    requestAttemptId: row.requestAttemptId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}
