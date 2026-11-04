import type {
  EwayBillAttemptOutcome,
  EwayBillAttemptView,
  EwayBillHistoryResponse,
  EwayBillMovementInfo,
  EwayBillMovementRecord,
  EwayBillRecordView,
  GstIntegrationMode,
} from '@erve/types';
import type { EwayBillFactAttempt, EwayBillFactBill } from './eway-bill-eligibility.js';
import type { EwayBillRequestFacts } from './eway-bill-request.mapper.js';

// ---------------------------------------------------------------------------
// The persistence port of the B2B E-Way Bill operations. The service holds
// every rule; the port is deliberately dumb (load, conditional write, audit)
// so the rules are unit-testable against an in-memory implementation while the
// Prisma implementation is exercised by the disposable-Postgres integration
// tests (locks, unique indexes, transactions).
// ---------------------------------------------------------------------------

export interface EwayBillSettingsFacts {
  /** 0 when the settings row does not exist yet. */
  version: number;
  integrationMode: GstIntegrationMode;
  ewayBillGenerationEnabled: boolean;
}

/** One consistent read of everything a B2B decision needs. */
export interface EwayBillSnapshot {
  requestFacts: EwayBillRequestFacts;
  /** EwayBillMovement.version; 0 when no movement is captured. */
  movementVersion: number;
  bills: EwayBillFactBill[];
  attempts: EwayBillFactAttempt[];
  settings: EwayBillSettingsFacts;
}

export type StoredEwayBillAttempt = EwayBillAttemptView & { taxInvoiceId: string };

export interface EwayBillAttemptPatch {
  dispatchedAt?: Date;
  completedAt?: Date;
  reviewAfter?: Date | null;
  providerReference?: string;
  failureCode?: string;
  failureMessage?: string;
  resolvedById?: string;
  resolvedAt?: Date;
  resolutionReason?: string;
}

/**
 * Operations available inside withInvoiceLock. Every write is conditional or
 * backed by a unique index, so a lost race surfaces as a typed conflict (an
 * HttpError 409) or as `false`, never as silent corruption.
 */
export interface EwayBillMutationTx {
  loadSnapshot(): Promise<EwayBillSnapshot | null>;
  getMovement(): Promise<EwayBillMovementRecord>;
  /** True when any LIVE bill (any invoice, any status) already carries this number. */
  liveNumberExists(ewayBillNumber: string): Promise<boolean>;
  /** Optimistic: expectedVersion must equal the stored version (0 = create). Throws 409 STALE_VERSION. */
  saveMovement(input: {
    expectedVersion: number;
    movement: EwayBillMovementInfo;
    actorId: string;
  }): Promise<EwayBillMovementRecord>;
  /** A PREPARED DEMO attempt. A second open DEMO attempt for the invoice throws 409. */
  createDemoAttempt(input: {
    actorId: string;
    documentType: 'INV';
    documentNumber: string;
    documentDate: string;
    requestFingerprint: string;
    settingsVersion: number;
    movementVersion: number;
    reviewAfter: Date;
  }): Promise<EwayBillAttemptView>;
  getAttempt(attemptId: string): Promise<StoredEwayBillAttempt | null>;
  /** Applies only while the stored outcome is one of `from`; true when it applied. */
  transitionAttempt(input: {
    attemptId: string;
    from: readonly EwayBillAttemptOutcome[];
    to: EwayBillAttemptOutcome;
    patch?: EwayBillAttemptPatch;
  }): Promise<boolean>;
  /** DEMO / SYNTHETIC_DEMO / PROVIDER_GENERATED, tied to its attempt. */
  createDemoBill(input: {
    attemptId: string;
    actorId: string;
    ewayBillNumber: string;
    generatedAt: Date | null;
    validUntil: Date | null;
    providerReference: string;
  }): Promise<EwayBillRecordView>;
  /** LIVE / UNVERIFIED_REFERENCE / EXTERNALLY_LINKED. A duplicate number or active bill throws 409. */
  createLinkedBill(input: { actorId: string; ewayBillNumber: string }): Promise<EwayBillRecordView>;
  audit(entry: { actorId: string; action: string; metadata: Record<string, unknown> }): Promise<void>;
}

export interface EwayBillOperationsRepository {
  /** Read-only. null when the Tax Invoice does not exist. */
  loadSnapshot(taxInvoiceId: string): Promise<EwayBillSnapshot | null>;
  getMovement(taxInvoiceId: string): Promise<EwayBillMovementRecord | null>;
  listHistory(taxInvoiceId: string): Promise<EwayBillHistoryResponse | null>;
  /**
   * Runs `work` in ONE database transaction that first takes the Tax Invoice
   * lifecycle advisory lock (the same lock finalize / cancel / override take),
   * so E-Way Bill writes serialize with each other and with invoice lifecycle
   * changes. Never call a provider inside `work`.
   */
  withInvoiceLock<T>(taxInvoiceId: string, work: (tx: EwayBillMutationTx) => Promise<T>): Promise<T>;
}
