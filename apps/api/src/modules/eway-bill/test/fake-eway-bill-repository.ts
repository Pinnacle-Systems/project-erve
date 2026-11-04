import type {
  EwayBillAttemptOutcome,
  EwayBillAttemptView,
  EwayBillHistoryResponse,
  EwayBillMovementInfo,
  EwayBillMovementRecord,
} from '@erve/types';
import { HttpError } from '../../../errors/http-error.js';
import type { EwayBillFactAttempt, EwayBillFactBill } from '../eway-bill-eligibility.js';
import type {
  EwayBillMutationTx,
  EwayBillOperationsRepository,
  EwayBillSettingsFacts,
  EwayBillSnapshot,
  StoredEwayBillAttempt,
} from '../eway-bill-operations.port.js';
import { isOpenAttempt, toAttemptView, toBillView, type AttemptRow, type BillRow } from '../eway-bill-operations.views.js';
import { completeMovement } from './eway-bill-fixtures.js';
import { requestFacts } from './eway-bill-request-fixtures.js';

// ---------------------------------------------------------------------------
// An in-memory EwayBillOperationsRepository for DB-free service and route
// tests. It models what the real implementation relies on the database for:
//  - withInvoiceLock serializes callers (the advisory lock) and ROLLS BACK
//    when the callback throws (transaction semantics);
//  - the unique-index safeguards (one open attempt, one active bill per
//    mode, unique Live number) throw the same 409s as the Prisma repository.
// The real locks, indexes and transactions are covered by the disposable-
// Postgres integration tests that CI runs.
// ---------------------------------------------------------------------------

interface FakeAttempt {
  id: string;
  taxInvoiceId: string;
  integrationMode: 'DEMO' | 'LIVE';
  outcome: EwayBillAttemptOutcome;
  actorId: string;
  documentType: string;
  documentNumber: string;
  documentDate: string;
  requestFingerprint: string;
  settingsVersion: number;
  movementVersion: number | null;
  providerReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  reviewAfter: Date | null;
  resolvedById: string | null;
  resolvedAt: Date | null;
  resolutionReason: string | null;
}

interface FakeBill extends BillRow {
  taxInvoiceId: string;
}

interface FakeState {
  requestFacts: EwayBillSnapshot['requestFacts'];
  movement: { info: EwayBillMovementInfo | null; version: number; updatedAt: Date | null; updatedById: string | null };
  settings: EwayBillSettingsFacts;
  attempts: FakeAttempt[];
  bills: FakeBill[];
  audit: Array<{ actorId: string; action: string; metadata: Record<string, unknown> }>;
  sequence: number;
}

export interface FakeFaults {
  /** createDemoBill throws (simulates a post-dispatch persistence failure). */
  createDemoBill?: Error;
  /** transitionAttempt throws when moving to this outcome. */
  transitionTo?: Partial<Record<EwayBillAttemptOutcome, Error>>;
}

export interface FakeRepositoryOptions {
  now: () => Date;
  requestFacts?: EwayBillSnapshot['requestFacts'];
  movement?: EwayBillMovementInfo | null;
  movementVersion?: number;
  settings?: Partial<EwayBillSettingsFacts>;
}

const person = (id: string) => ({ id, name: `User ${id}` });

export function createFakeEwayBillRepository(options: FakeRepositoryOptions) {
  const baseFacts = options.requestFacts ?? requestFacts({ movement: null });
  const movement = options.movement === undefined ? completeMovement() : options.movement;
  const state: FakeState = {
    requestFacts: { ...baseFacts, movement },
    movement: {
      info: movement,
      version: movement ? (options.movementVersion ?? 1) : 0,
      updatedAt: movement ? options.now() : null,
      updatedById: movement ? 'seed' : null,
    },
    settings: { version: 3, integrationMode: 'DEMO', ewayBillGenerationEnabled: true, ...options.settings },
    attempts: [],
    bills: [],
    audit: [],
    sequence: 0,
  };
  const faults: FakeFaults = {};
  const invoiceId = baseFacts.invoice.id;
  let chain: Promise<void> = Promise.resolve();
  let lockHolders = 0;
  const stats = { maxConcurrentLockHolders: 0 };

  const nextId = (prefix: string) => `${prefix}-${++state.sequence}`;

  const attemptRow = (attempt: FakeAttempt): AttemptRow => ({
    id: attempt.id,
    integrationMode: attempt.integrationMode,
    outcome: attempt.outcome,
    actor: person(attempt.actorId),
    documentType: attempt.documentType,
    documentNumber: attempt.documentNumber,
    documentDate: new Date(`${attempt.documentDate}T00:00:00.000Z`),
    settingsVersion: attempt.settingsVersion,
    movementVersion: attempt.movementVersion,
    failureCode: attempt.failureCode,
    failureMessage: attempt.failureMessage,
    createdAt: attempt.createdAt,
    dispatchedAt: attempt.dispatchedAt,
    completedAt: attempt.completedAt,
    reviewAfter: attempt.reviewAfter,
    resolvedBy: attempt.resolvedById ? person(attempt.resolvedById) : null,
    resolvedAt: attempt.resolvedAt,
    resolutionReason: attempt.resolutionReason,
    ewayBill: state.bills.find((bill) => bill.requestAttemptId === attempt.id) ?? null,
  });
  const view = (attempt: FakeAttempt): EwayBillAttemptView => toAttemptView(attemptRow(attempt), options.now());
  const stored = (attempt: FakeAttempt): StoredEwayBillAttempt => ({ ...view(attempt), taxInvoiceId: attempt.taxInvoiceId });

  const movementRecord = (): EwayBillMovementRecord => ({
    taxInvoiceId: invoiceId,
    version: state.movement.version,
    captured: state.movement.info !== null,
    movement: state.movement.info ?? {
      transportMode: null,
      vehicleNumber: null,
      vehicleType: null,
      transporterId: null,
      transporterName: null,
      transportDocumentNumber: null,
      transportDocumentDate: null,
      approximateDistanceKm: null,
      shipToArrangement: null,
      dispatchFromArrangement: null,
      dispatchFrom: null,
    },
    updatedAt: state.movement.updatedAt ? state.movement.updatedAt.toISOString() : null,
    updatedBy: state.movement.updatedById ? person(state.movement.updatedById) : null,
  });

  const snapshot = (): EwayBillSnapshot => {
    const bills: EwayBillFactBill[] = state.bills.map((bill) => ({
      id: bill.id,
      source: bill.source,
      status: bill.status,
      integrationMode: bill.integrationMode,
      verificationStatus: bill.verificationStatus,
      ewayBillNumber: bill.ewayBillNumber,
      generatedAt: bill.generatedAt,
      validUntil: bill.validUntil,
    }));
    const attempts: EwayBillFactAttempt[] = state.attempts.map((attempt) => ({
      id: attempt.id,
      integrationMode: attempt.integrationMode,
      outcome: attempt.outcome,
    }));
    return structuredClone({
      requestFacts: { ...state.requestFacts, movement: state.movement.info },
      movementVersion: state.movement.version,
      bills,
      attempts,
      settings: state.settings,
    });
  };

  const buildTx = (id: string): EwayBillMutationTx => ({
    async loadSnapshot() {
      return id === invoiceId ? snapshot() : null;
    },
    async getMovement() {
      return movementRecord();
    },
    async liveNumberExists(number) {
      return state.bills.some((bill) => bill.integrationMode === 'LIVE' && bill.ewayBillNumber === number);
    },
    async saveMovement({ expectedVersion, movement: info, actorId }) {
      if (state.movement.version !== expectedVersion) {
        throw new HttpError(409, 'STALE_VERSION', 'E-Way Bill movement changed since it was loaded');
      }
      state.movement = {
        info: structuredClone(info),
        version: expectedVersion + 1,
        updatedAt: options.now(),
        updatedById: actorId,
      };
      return movementRecord();
    },
    async createDemoAttempt(input) {
      if (state.attempts.some((a) => a.integrationMode === 'DEMO' && isOpenAttempt(a.outcome))) {
        throw HttpError.conflict('An E-Way Bill request for this invoice is already open', {
          reason: 'EWAY_BILL_ATTEMPT_ALREADY_OPEN',
        });
      }
      const attempt: FakeAttempt = {
        id: nextId('attempt'),
        taxInvoiceId: invoiceId,
        integrationMode: 'DEMO',
        outcome: 'PREPARED',
        actorId: input.actorId,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentDate: input.documentDate,
        requestFingerprint: input.requestFingerprint,
        settingsVersion: input.settingsVersion,
        movementVersion: input.movementVersion,
        providerReference: null,
        failureCode: null,
        failureMessage: null,
        createdAt: options.now(),
        dispatchedAt: null,
        completedAt: null,
        reviewAfter: input.reviewAfter,
        resolvedById: null,
        resolvedAt: null,
        resolutionReason: null,
      };
      state.attempts.push(attempt);
      return view(attempt);
    },
    async getAttempt(attemptId) {
      const attempt = state.attempts.find((a) => a.id === attemptId);
      return attempt ? stored(attempt) : null;
    },
    async transitionAttempt({ attemptId, from, to, patch }) {
      const fault = faults.transitionTo?.[to];
      if (fault) throw fault;
      const attempt = state.attempts.find((a) => a.id === attemptId);
      if (!attempt || !from.includes(attempt.outcome)) return false;
      attempt.outcome = to;
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (value !== undefined) (attempt as unknown as Record<string, unknown>)[key] = value;
      }
      return true;
    },
    async createDemoBill(input) {
      if (faults.createDemoBill) throw faults.createDemoBill;
      if (state.bills.some((b) => b.status === 'ACTIVE' && b.integrationMode === 'DEMO')) {
        throw HttpError.conflict('A Demo E-Way Bill already exists for this invoice');
      }
      const bill: FakeBill = {
        id: nextId('bill'),
        taxInvoiceId: invoiceId,
        source: 'PROVIDER_GENERATED',
        status: 'ACTIVE',
        integrationMode: 'DEMO',
        verificationStatus: 'SYNTHETIC_DEMO',
        verifiedAt: null,
        ewayBillNumber: input.ewayBillNumber,
        generatedAt: input.generatedAt,
        validUntil: input.validUntil,
        requestAttemptId: input.attemptId,
        createdAt: options.now(),
        createdBy: person(input.actorId),
      };
      state.bills.push(bill);
      return toBillView(bill);
    },
    async createLinkedBill(input) {
      if (
        state.bills.some((b) => b.integrationMode === 'LIVE' && b.ewayBillNumber === input.ewayBillNumber) ||
        state.bills.some((b) => b.status === 'ACTIVE' && b.integrationMode === 'LIVE')
      ) {
        throw HttpError.conflict('This E-Way Bill number is already recorded');
      }
      const bill: FakeBill = {
        id: nextId('bill'),
        taxInvoiceId: invoiceId,
        source: 'EXTERNALLY_LINKED',
        status: 'ACTIVE',
        integrationMode: 'LIVE',
        verificationStatus: 'UNVERIFIED_REFERENCE',
        verifiedAt: null,
        ewayBillNumber: input.ewayBillNumber,
        generatedAt: null,
        validUntil: null,
        requestAttemptId: null,
        createdAt: options.now(),
        createdBy: person(input.actorId),
      };
      state.bills.push(bill);
      return toBillView(bill);
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
  });

  const repository: EwayBillOperationsRepository = {
    async loadSnapshot(id) {
      return id === invoiceId ? snapshot() : null;
    },
    async getMovement(id) {
      return id === invoiceId ? movementRecord() : null;
    },
    async listHistory(id): Promise<EwayBillHistoryResponse | null> {
      if (id !== invoiceId) return null;
      return {
        taxInvoiceId: id,
        attempts: [...state.attempts].reverse().map(view),
        ewayBills: [...state.bills].reverse().map(toBillView),
        events: state.audit.map((entry, index) => ({
          id: `event-${index}`,
          action: entry.action,
          createdAt: options.now().toISOString(),
          actor: person(entry.actorId),
          metadata: entry.metadata,
        })),
      };
    },
    async withInvoiceLock(id, work) {
      const previous = chain;
      let release!: () => void;
      chain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      lockHolders += 1;
      stats.maxConcurrentLockHolders = Math.max(stats.maxConcurrentLockHolders, lockHolders);
      const backup = structuredClone(state);
      try {
        return await work(buildTx(id));
      } catch (error) {
        Object.assign(state, backup); // roll back, in place so held references stay valid
        throw error;
      } finally {
        lockHolders -= 1;
        release();
      }
    },
  };

  return {
    repository,
    faults,
    /** Direct access for arranging and asserting; mutate only between operations. */
    state,
    stats,
    /** Seeds an attempt in any outcome, as if left behind by an earlier request. */
    seedAttempt(over: Partial<FakeAttempt> & { outcome: EwayBillAttemptOutcome }): FakeAttempt {
      const attempt: FakeAttempt = {
        id: nextId('attempt'),
        taxInvoiceId: invoiceId,
        integrationMode: 'DEMO',
        actorId: 'user-1',
        documentType: 'INV',
        documentNumber: state.requestFacts.invoice.invoiceNumber ?? 'X',
        documentDate: '2026-11-04',
        requestFingerprint: 'seeded',
        settingsVersion: state.settings.version,
        movementVersion: state.movement.version,
        providerReference: null,
        failureCode: null,
        failureMessage: null,
        createdAt: options.now(),
        dispatchedAt: null,
        completedAt: null,
        reviewAfter: null,
        resolvedById: null,
        resolvedAt: null,
        resolutionReason: null,
        ...over,
      };
      state.attempts.push(attempt);
      return attempt;
    },
    seedBill(over: Partial<FakeBill> = {}): FakeBill {
      const bill: FakeBill = {
        id: nextId('bill'),
        taxInvoiceId: invoiceId,
        source: 'PROVIDER_GENERATED',
        status: 'ACTIVE',
        integrationMode: 'DEMO',
        verificationStatus: 'SYNTHETIC_DEMO',
        verifiedAt: null,
        ewayBillNumber: 'TEST-SEEDED',
        generatedAt: null,
        validUntil: null,
        requestAttemptId: null,
        createdAt: options.now(),
        createdBy: person('user-1'),
        ...over,
      };
      state.bills.push(bill);
      return bill;
    },
  };
}
