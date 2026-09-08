import type { PooledFactoryInventoryLine } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

// The Phase 2.1 target fact (see the Job Order Production Plan / QA-Pooled
// Inventory Decoupling plan §12/§29): Final-QA-passed stock is dispatch-
// allocatable pooled inventory keyed by Factory + Style + Size, computed
// purely via QaReleaseLine.jobOrderLineSizeId -> JobOrderLineSize ->
// JobOrderLine -> JobOrder (factoryId, styleId) + JobOrderLineSize.sizeId.
// Deliberately does NOT touch QaReleaseLine.purchaseOrderLineSizeId — that
// field is an isolated legacy Sale Order compatibility bridge only (see
// quality-executions.service.ts resolveLegacyPurchaseOrderLineSizeIds); this
// pool is correct and complete regardless of how many source Order Sheets
// fed each contributing Job Order.
//
// Consumption semantics: StockAllocation.status is only ever mutated in
// sale-orders.service.ts (cancel/reject releases ACTIVE allocations back to
// RELEASED; approve's re-allocation logic releases a superseded allocation
// and creates a new ACTIVE one). No file under apps/api/src/modules/
// fulfillment/* (dispatch, packing, invoice-handoff, distributor-sales-
// report, distributor-return) ever mutates it — factory-source-
// resolution.ts's own comment confirms the allocation ledger is never
// touched from packing through dispatch. So an allocation that has been
// dispatched/invoiced/sold stays ACTIVE forever (permanently committed,
// correctly still subtracted); RELEASED exclusively means "freed back to
// the pool." Therefore `released - ACTIVE committed` is the complete
// formula — there is no separate "consumed" state to additionally subtract.
//
// Aggregation safety: released quantities and committed (ACTIVE allocation)
// quantities are fetched as two INDEPENDENT queries and merged in memory,
// exactly like sale-orders/inventory.service.ts's getAvailableQuantities —
// never joined directly, which would multiply a QaReleaseLine's own
// `quantity` once per matching StockAllocation row.
export async function getPooledFactoryInventory(
  client: Client,
  filters?: { factoryId?: string; styleId?: string; sizeId?: string },
): Promise<PooledFactoryInventoryLine[]> {
  const releaseLines = await client.qaReleaseLine.findMany({
    where: {
      jobOrderLineSize: {
        sizeId: filters?.sizeId,
        jobOrderLine: {
          styleId: filters?.styleId,
          jobOrder: { factoryId: filters?.factoryId },
        },
      },
    },
    select: {
      id: true,
      quantity: true,
      jobOrderLineSize: {
        select: {
          sizeId: true,
          size: { select: { code: true, label: true } },
          jobOrderLine: {
            select: {
              styleId: true,
              style: { select: { styleNumber: true, styleName: true } },
              jobOrder: {
                select: { factoryId: true, factory: { select: { code: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });

  const committed = await client.stockAllocation.groupBy({
    by: ['qaReleaseLineId'],
    where: { qaReleaseLineId: { in: releaseLines.map((line) => line.id) }, status: 'ACTIVE' },
    _sum: { quantity: true },
  });
  const committedByLine = new Map(committed.map((row) => [row.qaReleaseLineId, row._sum.quantity ?? 0]));

  const pool = new Map<string, PooledFactoryInventoryLine>();
  for (const line of releaseLines) {
    const jobOrderLine = line.jobOrderLineSize.jobOrderLine;
    const jobOrder = jobOrderLine.jobOrder;
    const key = `${jobOrder.factoryId}:${jobOrderLine.styleId}:${line.jobOrderLineSize.sizeId}`;
    const committedQuantity = committedByLine.get(line.id) ?? 0;
    const availableQuantity = line.quantity - committedQuantity;
    const existing = pool.get(key);
    if (existing) {
      existing.releasedQuantity += line.quantity;
      existing.committedQuantity += committedQuantity;
      existing.availableQuantity += availableQuantity;
      continue;
    }
    pool.set(key, {
      factoryId: jobOrder.factoryId,
      factoryCode: jobOrder.factory.code,
      factoryName: jobOrder.factory.name,
      styleId: jobOrderLine.styleId,
      styleNumber: jobOrderLine.style.styleNumber,
      styleName: jobOrderLine.style.styleName,
      sizeId: line.jobOrderLineSize.sizeId,
      sizeCode: line.jobOrderLineSize.size.code,
      sizeLabel: line.jobOrderLineSize.size.label,
      releasedQuantity: line.quantity,
      committedQuantity,
      availableQuantity,
    });
  }
  return [...pool.values()];
}

export interface AvailabilityRow {
  released: number;
  committed: number;
  available: number;
}

// The single implementation of "how much of a QA release line is still free
// to allocate" — released quantity minus the sum of ACTIVE StockAllocation
// rows against it. Relocated here from the retired sale-orders/inventory
// .service.ts (Dispatch Order Phase 3) since it is now core to Dispatch
// Order allocation, not a Sale-Order-only helper. Deliberately not
// denormalized onto QaReleaseLine (which must stay immutable) — this is the
// one place that recomputes it, from the StockAllocation ledger, every
// time. Call this AFTER acquiring the relevant dispatch-pool-* advisory
// locks when used inside a mutating transaction; read-only call sites
// (list/detail/pooled-inventory views) accept ordinary read-committed
// staleness like any other list view.
export async function getAvailableQuantities(
  client: Client,
  qaReleaseLineIds: string[],
): Promise<Map<string, AvailabilityRow>> {
  const result = new Map<string, AvailabilityRow>();
  if (qaReleaseLineIds.length === 0) return result;

  const [releaseLines, committed] = await Promise.all([
    client.qaReleaseLine.findMany({
      where: { id: { in: qaReleaseLineIds } },
      select: { id: true, quantity: true },
    }),
    client.stockAllocation.groupBy({
      by: ['qaReleaseLineId'],
      where: { qaReleaseLineId: { in: qaReleaseLineIds }, status: 'ACTIVE' },
      _sum: { quantity: true },
    }),
  ]);

  const committedByLine = new Map(committed.map((row) => [row.qaReleaseLineId, row._sum.quantity ?? 0]));
  for (const line of releaseLines) {
    const committedQuantity = committedByLine.get(line.id) ?? 0;
    result.set(line.id, {
      released: line.quantity,
      committed: committedQuantity,
      available: line.quantity - committedQuantity,
    });
  }
  return result;
}

export interface EligibleQaReleaseLineCandidate {
  id: string;
  releasedAt: Date;
  released: number;
}

// Row-level allocation candidates for one Factory+Style+Size pool key,
// oldest QaRelease.releasedAt first with id as a stable tiebreak
// (Dispatch Order Phase 3 §16: a deterministic technical inventory-lot
// selection strategy, not a business promise about Job Order preference).
// Mirrors getPooledFactoryInventory's join shape but returns individual
// release-line rows (with their own released quantity) instead of an
// aggregate, so the reservation planner in sale-orders.service.ts can
// greedily consume them in order. Callers are responsible for subtracting
// current commitments (getAvailableQuantities) and, during an update, for
// adding back this same Dispatch Order's own planned releases
// (effectiveAvailable) before treating a candidate as exhausted.
export async function getEligibleQaReleaseLinesForPool(
  client: Client,
  factoryId: string,
  styleId: string,
  sizeId: string,
): Promise<EligibleQaReleaseLineCandidate[]> {
  const releaseLines = await client.qaReleaseLine.findMany({
    where: {
      jobOrderLineSize: {
        sizeId,
        jobOrderLine: { styleId, jobOrder: { factoryId } },
      },
    },
    select: { id: true, quantity: true, release: { select: { releasedAt: true } } },
  });
  return releaseLines
    .map((line) => ({ id: line.id, releasedAt: line.release.releasedAt, released: line.quantity }))
    .sort((a, b) => a.releasedAt.getTime() - b.releasedAt.getTime() || a.id.localeCompare(b.id));
}
