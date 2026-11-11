import { createHash } from 'node:crypto';
import { createId } from '@erve/shared';
import { canSubmitRetailStoreFifoAction } from '@erve/shared';
import type {
  DistributorReturnView,
  DistributorSalesReportView,
  StoreFifoAvailability,
  StoreFifoReturnSubmitInput,
  StoreFifoSalesSubmitInput,
} from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { ensureFinancialYear } from '../master-data/financial-year.service.js';
import { getDistributorReturnDetail, generateReturnNumber } from './distributor-return.service.js';
import { getDistributorSalesReportDetail } from './distributor-sales-report.service.js';
import {
  computeAvailability,
  getSaleOrReturnPairQuantities,
  saleOrReturnPositionLockKey,
} from './sale-or-return-quantities.js';
import {
  allocateFifo,
  istDateOf,
  pairKey,
  partitionCandidates,
  type FifoAllocation,
  type FifoCandidate,
  type FifoConfirmationSource,
  type FifoPurchaseMode,
} from './retail-store-fifo-allocation.js';

// ---------------------------------------------------------------------------
// ISS-089 — Store-level FIFO Sales Reports and Returns.
//
// The Distributor never names a Dispatch. For one Retail Store x Style x Size the API:
//   1. serializes store-level requests for that cell (advisory lock),
//   2. loads the cell's source positions (erveDispatchId, saleOrderLineId) INSIDE the write
//      transaction - never trusting an earlier /sources response,
//   3. takes the existing per-position Sale-or-Return advisory locks (sorted, so the lock order is
//      compatible with the Dispatch-linked Sales Report / Return mutations),
//   4. re-reads the candidate set; if a position appeared meanwhile the attempt is rolled back and
//      retried from scratch (it is never allocated against a half-known set),
//   5. re-computes each position's authoritative availability with the shared helpers, allocates
//      oldest verified receipt first, and posts ordinary DistributorSalesReportLine /
//      DistributorReturnLine rows - one per source position.
// No second ledger and no synthetic Dispatch exist: every quantity is still derived from the
// existing records, so the existing Dispatch-linked flows, the A6 screen and the Sale-or-Return
// position all see store-level postings automatically.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
const TX_OPTIONS = { timeout: 30000, maxWait: 10000 } as const;

type Tx = Prisma.TransactionClient;
type Kind = 'SALE' | 'RETURN';

/** The candidate set changed between the first read and the position locks: retry the whole attempt. */
class CandidateSetChanged extends Error {}

interface CellScope {
  distributorId: string;
  retailStoreId: string;
  styleId: string;
  sizeId: string;
}

function resolveActorDistributor(actor: CurrentUser): string {
  if (!canSubmitRetailStoreFifoAction(actor)) {
    throw HttpError.forbidden('Only a Distributor can report sales or request returns for its Retail Stores');
  }
  const own = getSoleDistributorId(actor);
  if (!own) throw HttpError.forbidden('Your account is not mapped to exactly one Distributor');
  return own;
}

/** Only a mapped Retail Store is eligible: unmapped historical destinations must be reconciled first. */
function parseMappedStoreKey(storeKey: string): string {
  if (storeKey.startsWith('S:')) return storeKey.slice(2);
  throw HttpError.badRequest(
    'This is an unmapped historical destination. Store-level sales and returns are not available until it is reconciled to a Retail Store.',
  );
}

export function assertTransactionDate(date: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw HttpError.badRequest(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw HttpError.badRequest(`${label} must be a valid date (YYYY-MM-DD)`);
  }
  if (date > istDateOf(new Date())) {
    throw HttpError.badRequest(`${label} cannot be in the future`);
  }
}

interface CandidateRow {
  dispatch_id: string;
  sol_id: string;
  dispatch_number: string;
  dispatch_status: string;
  delivered_at: Date | null;
  source: FifoConfirmationSource;
  purchase_mode: FifoPurchaseMode;
}

/**
 * Every source position of the cell that carries a received ledger quantity, of any purchase mode
 * (so OUTRIGHT can be rejected with a specific reason) and any evidence quality (so unverified
 * positions can be reported rather than silently dropped). Distributor and Retail Store scoping is
 * applied in SQL: another Distributor's Store yields nothing.
 */
async function loadCandidates(client: Tx | typeof prisma, scope: CellScope): Promise<FifoCandidate[]> {
  const rows = await client.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      edl.erve_dispatch_id AS dispatch_id,
      edl.sale_order_line_id AS sol_id,
      ed.erve_dispatch_number AS dispatch_number,
      ed.status::text AS dispatch_status,
      ed.delivered_at AS delivered_at,
      ed.delivery_confirmation_source::text AS source,
      sodist.purchase_mode::text AS purchase_mode
    FROM erve_dispatch_delivery_lines edl
    INNER JOIN erve_dispatches ed ON ed.id = edl.erve_dispatch_id
    INNER JOIN sale_order_lines sol ON sol.id = edl.sale_order_line_id
    INNER JOIN sale_order_destinations sod ON sod.id = sol.destination_id
    INNER JOIN sale_order_distributors sodist ON sodist.id = sod.sale_order_distributor_id
    WHERE sod.retail_store_id = ${scope.retailStoreId}
      AND sodist.distributor_id = ${scope.distributorId}
      AND ed.distributor_id = ${scope.distributorId}
      AND sol.style_id = ${scope.styleId}
      AND sol.size_id = ${scope.sizeId}
      AND edl.received_quantity > 0
  `);
  return rows.map((row) => ({
    erveDispatchId: row.dispatch_id,
    erveDispatchNumber: row.dispatch_number,
    saleOrderLineId: row.sol_id,
    purchaseMode: row.purchase_mode,
    dispatchStatus: row.dispatch_status,
    deliveredAt: row.delivered_at,
    confirmationSource: row.source,
  }));
}

interface PositionQuantities {
  candidate: FifoCandidate;
  availableForSale: number;
  availableForReturn: number;
}

async function readAvailability(client: Tx, candidates: FifoCandidate[]): Promise<PositionQuantities[]> {
  const result: PositionQuantities[] = [];
  for (const candidate of candidates) {
    const quantities = await getSaleOrReturnPairQuantities(client, candidate.erveDispatchId, candidate.saleOrderLineId);
    const { availableForActualSale, availableForNewReturn } = computeAvailability(quantities);
    result.push({ candidate, availableForSale: availableForActualSale, availableForReturn: availableForNewReturn });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Read-only preview: what a Store-level action could allocate on a given date.
// ---------------------------------------------------------------------------

export async function getStoreFifoAvailability(
  actor: CurrentUser,
  query: { storeKey: string; styleId: string; sizeId: string; date: string },
): Promise<StoreFifoAvailability> {
  const distributorId = resolveActorDistributor(actor);
  const retailStoreId = parseMappedStoreKey(query.storeKey);
  assertTransactionDate(query.date, 'Date');
  const scope: CellScope = { distributorId, retailStoreId, styleId: query.styleId, sizeId: query.sizeId };

  return prisma.$transaction(
    async (tx) => {
      const candidates = await loadCandidates(tx, scope);
      const parts = partitionCandidates(candidates, query.date);
      const eligible = await readAvailability(tx, parts.eligible);
      const afterDate = await readAvailability(tx, parts.afterDate);
      const unverified = await readAvailability(tx, parts.unverified);
      const sum = (list: PositionQuantities[], pick: (p: PositionQuantities) => number) =>
        list.reduce((total, p) => total + Math.max(0, pick(p)), 0);
      return {
        storeKey: query.storeKey,
        styleId: query.styleId,
        sizeId: query.sizeId,
        asOfDate: query.date,
        availableForSale: sum(eligible, (p) => p.availableForSale),
        availableForReturn: sum(eligible, (p) => p.availableForReturn),
        eligibleSourceCount: eligible.filter((p) => p.availableForSale > 0 || p.availableForReturn > 0).length,
        excluded: {
          receivedAfterDateUnits: sum(afterDate, (p) => p.availableForSale),
          unverifiedReceiptUnits: sum(unverified, (p) => p.availableForSale),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
  );
}

// ---------------------------------------------------------------------------
// Allocation inside the write transaction.
// ---------------------------------------------------------------------------

async function lockAndAllocate(
  tx: Tx,
  scope: CellScope,
  kind: Kind,
  quantity: number,
  date: string,
): Promise<FifoAllocation[]> {
  // (2) One store-level request per cell at a time.
  const cellKey = `store-fifo-${scope.distributorId}:${scope.retailStoreId}:${scope.styleId}:${scope.sizeId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cellKey}))`;

  const first = await loadCandidates(tx, scope);
  if (first.length === 0) {
    throw HttpError.badRequest('There is no confirmed received stock for this Store, Style and Size');
  }
  const saleReturn = first.filter((c) => c.purchaseMode === 'SALE_RETURN');
  if (saleReturn.length === 0) {
    throw HttpError.badRequest(
      'This stock is Outright, not Sale-or-Return. Only Sale-or-Return stock can be reported sold or returned.',
    );
  }

  // (3) The same advisory-lock keys, in the same sorted order, as the Dispatch-linked mutations.
  const lockKeys = [...new Set(saleReturn.map((c) => saleOrReturnPositionLockKey(c.erveDispatchId, c.saleOrderLineId)))].sort();
  for (const key of lockKeys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  // (4) Candidate-set change guard.
  const second = await loadCandidates(tx, scope);
  const firstKeys = new Set(saleReturn.map(pairKey));
  const secondSaleReturn = second.filter((c) => c.purchaseMode === 'SALE_RETURN');
  if (secondSaleReturn.length !== firstKeys.size || secondSaleReturn.some((c) => !firstKeys.has(pairKey(c)))) {
    throw new CandidateSetChanged();
  }

  const parts = partitionCandidates(secondSaleReturn, date);
  if (parts.eligible.length === 0) {
    if (parts.unverified.length > 0 && parts.afterDate.length === 0) {
      throw HttpError.badRequest(
        'The receipt date of this stock cannot be verified (legacy or missing receipt evidence), so it cannot be allocated.',
      );
    }
    throw HttpError.badRequest(
      `No stock for this Store, Style and Size had been received on or before ${date}`,
    );
  }

  // (5) Authoritative quantities, read AFTER the locks.
  const positions = await readAvailability(tx, parts.eligible);
  const { allocations, shortfall, totalAvailable } = allocateFifo(
    positions.map((p) => ({
      candidate: p.candidate,
      available: kind === 'SALE' ? p.availableForSale : p.availableForReturn,
    })),
    quantity,
  );
  if (shortfall > 0) {
    throw HttpError.badRequest(
      `Requested quantity ${quantity} exceeds the ${totalAvailable} unit(s) available ${
        kind === 'SALE' ? 'for Actual Sale' : 'to return'
      } for this Store, Style and Size${parts.afterDate.length > 0 ? ` on ${date}` : ''}`,
      { requested: quantity, available: totalAvailable },
    );
  }
  return allocations;
}

function digestOf(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** The idempotency decision, taken under a per-key lock so concurrent retries cannot both create. */
async function findReplay(
  tx: Tx,
  actor: CurrentUser,
  distributorId: string,
  key: string,
  kind: Kind,
  digest: string,
): Promise<string | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-fifo-idempotency-${distributorId}:${key}`}))`;
  const [sale, ret] = await Promise.all([
    tx.distributorSalesReport.findUnique({
      where: { distributorId_idempotencyKey: { distributorId, idempotencyKey: key } },
      select: { id: true, submittedById: true, requestDigest: true },
    }),
    tx.distributorReturn.findUnique({
      where: { distributorId_idempotencyKey: { distributorId, idempotencyKey: key } },
      select: { id: true, submittedById: true, requestDigest: true },
    }),
  ]);
  const existing = kind === 'SALE' ? sale : ret;
  if ((kind === 'SALE' ? ret : sale) !== null) {
    throw HttpError.conflict('This Idempotency-Key was already used for a different kind of request');
  }
  if (!existing) return null;
  if (existing.submittedById !== actor.id || existing.requestDigest !== digest) {
    throw HttpError.conflict('This Idempotency-Key was already used with a different request');
  }
  return existing.id;
}

async function withRetries<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CandidateSetChanged && attempt < MAX_ATTEMPTS) continue;
      if (error instanceof CandidateSetChanged) {
        throw HttpError.conflict('The available stock changed while the request was being processed. Please retry.');
      }
      throw error;
    }
  }
}

const allocationAudit = (allocations: FifoAllocation[]) =>
  allocations.map((a) => ({
    erveDispatchId: a.candidate.erveDispatchId,
    saleOrderLineId: a.candidate.saleOrderLineId,
    quantity: a.quantity,
  }));

// ---------------------------------------------------------------------------
// Report Sold
// ---------------------------------------------------------------------------

export async function submitStoreFifoSalesReport(
  actor: CurrentUser,
  input: StoreFifoSalesSubmitInput,
  idempotencyKey: string,
): Promise<{ replayed: boolean; salesReport: DistributorSalesReportView }> {
  const distributorId = resolveActorDistributor(actor);
  const retailStoreId = parseMappedStoreKey(input.storeKey);
  assertTransactionDate(input.reportDate, 'Report date');
  const remarks = input.remarks?.trim() || null;
  const digest = digestOf({
    kind: 'SALE',
    storeKey: input.storeKey,
    styleId: input.styleId,
    sizeId: input.sizeId,
    quantity: input.quantity,
    date: input.reportDate,
    remarks,
  });
  const scope: CellScope = { distributorId, retailStoreId, styleId: input.styleId, sizeId: input.sizeId };

  const { id, replayed } = await withRetries(() =>
    prisma.$transaction(async (tx) => {
      const replay = await findReplay(tx, actor, distributorId, idempotencyKey, 'SALE', digest);
      if (replay) return { id: replay, replayed: true };

      const allocations = await lockAndAllocate(tx, scope, 'SALE', input.quantity, input.reportDate);
      const reportId = createId();
      await tx.distributorSalesReport.create({
        data: {
          id: reportId,
          distributorId,
          reportDate: new Date(input.reportDate),
          remarks,
          submittedById: actor.id,
          idempotencyKey,
          requestDigest: digest,
          lines: {
            create: allocations.map((a) => ({
              id: createId(),
              erveDispatchId: a.candidate.erveDispatchId,
              saleOrderLineId: a.candidate.saleOrderLineId,
              quantitySold: a.quantity,
            })),
          },
        },
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'DISTRIBUTOR_SALES_REPORT_SUBMITTED',
          entityType: 'DistributorSalesReport',
          entityId: reportId,
          metadata: {
            distributorId,
            lineCount: allocations.length,
            storeLevelFifo: true,
            retailStoreId,
            styleId: input.styleId,
            sizeId: input.sizeId,
            requestedQuantity: input.quantity,
            allocations: allocationAudit(allocations),
          },
        },
        tx,
      );
      // Like the Dispatch-linked flow, this never touches InvoiceHandoff: an Actual Sale is a
      // sell-through fact, not a new invoice.
      return { id: reportId, replayed: false };
    }, TX_OPTIONS),
  );

  return { replayed, salesReport: await getDistributorSalesReportDetail(actor, id) };
}

// ---------------------------------------------------------------------------
// Request Return
// ---------------------------------------------------------------------------

export async function submitStoreFifoReturn(
  actor: CurrentUser,
  input: StoreFifoReturnSubmitInput,
  idempotencyKey: string,
): Promise<{ replayed: boolean; distributorReturn: DistributorReturnView }> {
  const distributorId = resolveActorDistributor(actor);
  const retailStoreId = parseMappedStoreKey(input.storeKey);
  assertTransactionDate(input.returnDate, 'Return date');
  const returnReason = input.returnReason?.trim();
  if (!returnReason) throw HttpError.badRequest('A return reason is required');
  const remarks = input.remarks?.trim() || null;
  const digest = digestOf({
    kind: 'RETURN',
    storeKey: input.storeKey,
    styleId: input.styleId,
    sizeId: input.sizeId,
    quantity: input.quantity,
    date: input.returnDate,
    returnReason,
    remarks,
  });
  const scope: CellScope = { distributorId, retailStoreId, styleId: input.styleId, sizeId: input.sizeId };

  const { id, replayed } = await withRetries(() =>
    prisma.$transaction(async (tx) => {
      const replay = await findReplay(tx, actor, distributorId, idempotencyKey, 'RETURN', digest);
      if (replay) return { id: replay, replayed: true };

      const allocations = await lockAndAllocate(tx, scope, 'RETURN', input.quantity, input.returnDate);
      const returnId = createId();
      const financialYear = await ensureFinancialYear(tx, new Date(input.returnDate));
      const { returnNumber, returnSerial } = await generateReturnNumber(tx, financialYear);
      await tx.distributorReturn.create({
        data: {
          id: returnId,
          returnNumber,
          distributorId,
          returnDate: new Date(input.returnDate),
          returnReason,
          remarks,
          submittedById: actor.id,
          financialYearId: financialYear.id,
          returnSerial,
          idempotencyKey,
          requestDigest: digest,
          lines: {
            create: allocations.map((a) => ({
              id: createId(),
              erveDispatchId: a.candidate.erveDispatchId,
              saleOrderLineId: a.candidate.saleOrderLineId,
              requestedQuantity: a.quantity,
            })),
          },
        },
      });
      await recordAuditLog(
        {
          actorId: actor.id,
          action: 'DISTRIBUTOR_RETURN_SUBMITTED',
          entityType: 'DistributorReturn',
          entityId: returnId,
          metadata: {
            returnNumber,
            distributorId,
            lineCount: allocations.length,
            storeLevelFifo: true,
            retailStoreId,
            styleId: input.styleId,
            sizeId: input.sizeId,
            requestedQuantity: input.quantity,
            allocations: allocationAudit(allocations),
          },
        },
        tx,
      );
      return { id: returnId, replayed: false };
    }, TX_OPTIONS),
  );

  return { replayed, distributorReturn: await getDistributorReturnDetail(actor, id) };
}
