import type { PooledFactoryInventoryLine } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import type { CurrentUser } from '../../auth/current-user.js';
import {
  stylePrimaryImageInclude,
  toPrimaryImageView,
} from '../master-data/style-images.service.js';

type Client = Prisma.TransactionClient | typeof prisma;

// BUG-007 security correction: excludeSaleOrderId must never let a caller
// inflate availableQuantity by naming an arbitrary Dispatch Order. Only a
// role that can actually edit Dispatch Orders may use it, and only for an
// order that genuinely exists, belongs to the requested Factory, and is
// still editable. Mirrors sale-orders.service.ts's
// assertDispatchOrderMutationAccess/isDispatchOrderLocked exactly —
// duplicated narrowly here (not imported) because sale-orders.service.ts
// already imports this file, and importing back would create a cycle. Keep
// both in sync if the Dispatch Order mutation/lock rules ever change.
export async function assertExcludableDispatchOrder(
  client: Client,
  user: CurrentUser,
  factoryId: string | undefined,
  excludeSaleOrderId: string,
): Promise<void> {
  if (!user.roles.some((r) => r === 'ADMIN' || r === 'MERCHANDISER')) {
    throw HttpError.forbidden('You do not have permission to manage dispatch orders');
  }
  if (!factoryId) {
    throw HttpError.badRequest('factoryId is required when excludeSaleOrderId is provided');
  }
  const order = await client.saleOrder.findUnique({
    where: { id: excludeSaleOrderId },
    select: { factoryId: true },
  });
  if (!order) throw HttpError.badRequest('Dispatch order not found');
  if (order.factoryId !== factoryId) {
    throw HttpError.badRequest('Dispatch order does not belong to the requested factory');
  }
  const [readyFactoryDispatch, anyErveDispatch] = await Promise.all([
    client.factoryDispatch.count({
      where: { saleOrderId: excludeSaleOrderId, status: 'READY_FOR_ERVE' },
    }),
    client.erveDispatch.count({ where: { saleOrderId: excludeSaleOrderId } }),
  ]);
  if (readyFactoryDispatch > 0 || anyErveDispatch > 0) {
    throw HttpError.badRequest(
      'This dispatch order is locked: Factory Dispatch has already occurred',
    );
  }
}

// Final-QA stock is pooled by Factory + Style + Size through the authoritative
// QaReleaseLine -> JobOrderLineSize -> JobOrderLine -> JobOrder lineage.
// ACTIVE allocations remain committed through dispatch/sale; RELEASED means
// returned to the pool. Never subtract downstream dispatch quantities again.
//
// Aggregate releases and commitments independently before joining pool totals:
// a raw release/allocation join would multiply released stock. Keep zero and
// negative pools and every historical Size: Dispatch Order equal-split size
// resolution and reporting also consume this helper. Reservation lot selection,
// allocation ordering and locks remain in the separate helpers below.
export async function getPooledFactoryInventory(
  client: Client,
  filters?: {
    factoryId?: string;
    styleId?: string;
    sizeId?: string;
    // RPT1 6.4 — reporting-only filters. "Current Style Season" (RPT0 2.3):
    // the pool is grouped by Style, and a Style's Season is a fixed,
    // point-in-time attribute, so this filters by the Style's own current
    // seasonId, never a reconstructed transaction-time Season.
    seasonId?: string;
    recordOrigin?: 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT';
    // BUG-007: when editing an existing Dispatch Order, its own ACTIVE
    // allocations are still committed against the pool and would otherwise
    // make availableQuantity understate what the edit can actually reserve
    // (the edit releases-and-re-reserves in one transaction — mirrors
    // reserveAcrossPools's effectiveAvailable in sale-orders.service.ts).
    // Passing the order being edited adds its own committed quantity back.
    excludeSaleOrderId?: string;
  },
): Promise<PooledFactoryInventoryLine[]> {
  const predicates: Prisma.Sql[] = [];
  if (filters?.factoryId !== undefined)
    predicates.push(Prisma.sql`jo.factory_id = ${filters.factoryId}`);
  if (filters?.styleId !== undefined)
    predicates.push(Prisma.sql`jol.style_id = ${filters.styleId}`);
  if (filters?.sizeId !== undefined) predicates.push(Prisma.sql`jols.size_id = ${filters.sizeId}`);
  if (filters?.seasonId) predicates.push(Prisma.sql`s.season_id = ${filters.seasonId}`);
  if (filters?.recordOrigin !== undefined) {
    predicates.push(Prisma.sql`jo.record_origin = ${filters.recordOrigin}::"RecordOrigin"`);
  }
  const where = predicates.length
    ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}`
    : Prisma.empty;
  const ownOrderJoin = filters?.excludeSaleOrderId
    ? Prisma.sql`JOIN sale_order_lines sol ON sol.id = sa.sale_order_line_id`
    : Prisma.empty;
  const ownQuantity = filters?.excludeSaleOrderId
    ? Prisma.sql`COALESCE(SUM(sa.quantity) FILTER (WHERE sol.sale_order_id = ${filters.excludeSaleOrderId}), 0)`
    : Prisma.sql`0::bigint`;

  const rows = await client.$queryRaw<RawPoolRow[]>(Prisma.sql`
    WITH filtered_releases AS MATERIALIZED (
      SELECT qrl.id, qrl.quantity, jo.factory_id, jol.style_id, jols.size_id
      FROM qa_release_lines qrl
      JOIN job_order_line_sizes jols ON jols.id = qrl.job_order_line_size_id
      JOIN job_order_lines jol ON jol.id = jols.job_order_line_id
      JOIN job_orders jo ON jo.id = jol.job_order_id
      JOIN styles s ON s.id = jol.style_id
      ${where}
    ), released AS (
      SELECT factory_id, style_id, size_id, SUM(quantity) AS quantity
      FROM filtered_releases
      GROUP BY factory_id, style_id, size_id
    ), committed AS (
      SELECT fr.factory_id, fr.style_id, fr.size_id,
        SUM(sa.quantity) AS quantity, ${ownQuantity} AS own_quantity
      FROM filtered_releases fr
      JOIN stock_allocations sa ON sa.qa_release_line_id = fr.id AND sa.status = 'ACTIVE'
      ${ownOrderJoin}
      GROUP BY fr.factory_id, fr.style_id, fr.size_id
    )
    SELECT r.factory_id AS "factoryId", f.code AS "factoryCode", f.name AS "factoryName",
      r.style_id AS "styleId", s.style_number AS "styleNumber", s.style_name AS "styleName",
      r.size_id AS "sizeId", sz.code AS "sizeCode", sz.label AS "sizeLabel",
      sz.sort_order AS "sizeSortOrder", r.quantity AS "releasedQuantity",
      COALESCE(c.quantity, 0) AS "committedQuantity",
      r.quantity - COALESCE(c.quantity, 0) + COALESCE(c.own_quantity, 0) AS "availableQuantity"
    FROM released r
    LEFT JOIN committed c USING (factory_id, style_id, size_id)
    JOIN factories f ON f.id = r.factory_id
    JOIN styles s ON s.id = r.style_id
    JOIN sizes sz ON sz.id = r.size_id
  `);

  // SUM(int4) returns bigint. Validate every exposed total before converting;
  // never cast sums to int4 or silently round quantities at the API boundary.
  const pool = rows.map((row) => ({
    ...row,
    releasedQuantity: safeInventoryQuantity(row.releasedQuantity, 'releasedQuantity'),
    committedQuantity: safeInventoryQuantity(row.committedQuantity, 'committedQuantity'),
    availableQuantity: safeInventoryQuantity(row.availableQuantity, 'availableQuantity'),
  }));
  if (pool.length === 0) return [];

  // Only distinct output Styles reach Prisma: neither historical release IDs
  // nor per-release metadata are materialized. Reuse the established primary /
  // fallback image ordering, in a batch rather than one query per pool row.
  const styles = await client.style.findMany({
    where: { id: { in: [...new Set(pool.map((row) => row.styleId))] } },
    select: { id: true, images: stylePrimaryImageInclude },
  });
  const imageByStyle = new Map(styles.map((style) => [style.id, toPrimaryImageView(style.images)]));
  return pool.map((row) => ({ ...row, primaryImage: imageByStyle.get(row.styleId) ?? null }));
}

type RawPoolRow = Omit<
  PooledFactoryInventoryLine,
  'primaryImage' | 'releasedQuantity' | 'committedQuantity' | 'availableQuantity'
> & { releasedQuantity: bigint; committedQuantity: bigint; availableQuantity: bigint };

function safeInventoryQuantity(value: bigint, field: string): number {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity)) {
    throw HttpError.internal(`Pooled inventory ${field} exceeds the safe integer range`);
  }
  return quantity;
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
