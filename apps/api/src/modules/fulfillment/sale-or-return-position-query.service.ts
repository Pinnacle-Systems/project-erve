import type { PaginatedResponse } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import { computeAvailability } from './sale-or-return-quantities.js';

// ---------------------------------------------------------------------------
// PAG-P1-07 — bounded database-side read path for the Sale-or-Return
// consignment position. Grain is (erveDispatchId, saleOrderLineId), exactly
// as before (see distributor-sales-report.service.ts's module doc for what
// this position represents and why).
//
// Responsibility split (see distributor-sales-report.service.ts and
// reports.service.ts): this module owns *only* bounded DB-side candidate
// selection, component aggregation, filtering, ordering and pagination.
// Authorization/distributor-scope resolution stays in
// distributor-sales-report.service.ts; the authoritative
// dispatched/received/.../remaining business arithmetic stays in
// sale-or-return-quantities.ts's computeAvailability — this module never
// re-derives that formula, it only mirrors its first line
// (received - actualSold - returned) inside SQL as a bounding predicate for
// `onlyWithRemaining` / the reporting totals, and always recomputes the
// authoritative output values by calling computeAvailability() on the raw
// components once they're back in Node.
//
// All three entry points below (`listSaleOrReturnPositionsPage`,
// `getSaleOrReturnRemainingTotal`, `getSaleOrReturnGroupedTotals`) share the
// one `buildPositionComponentsCte` CTE: candidate (erveDispatchId,
// saleOrderLineId) pairs restricted to non-retired, SALE_RETURN-mode,
// actually-Erve-dispatched carton lines (identical eligibility to the old
// per-row Node loop), left-joined to their raw per-pair components
// (receivedQuantity, actualSoldQuantity, returnedQuantity,
// approvedAwaitingReceiptQuantity, pendingRequestedQuantity), each itself a
// GROUP BY aggregate in Postgres — never an unbounded OR-of-every-historical-
// pair array, and never materialized into a Node Map before aggregating.
// The three consumers differ only in what they do with pair_components
// afterwards: page (filter + keyset-paginate), total (SUM everything, no
// row-level cap — a report total must never silently exclude older
// history), grouped (GROUP BY distributor[, style], again no cap).
// ---------------------------------------------------------------------------

export interface SaleOrReturnPositionRow {
  erveDispatchId: string;
  erveDispatchNumber: string;
  dispatchDate: string;
  saleOrderId: string;
  saleOrderNumber: string;
  distributor: { id: string; code: string; name: string };
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
  returnableQuantity: number;
}

/**
 * The shared `candidate_pairs` + `pair_components` CTE body (no leading
 * `WITH`), reused verbatim by every query below so the eligibility
 * predicate and the five component aggregates can never drift between the
 * paginated list and the reporting totals.
 */
function buildPositionComponentsCte(distributorId: string | null): Prisma.Sql {
  return Prisma.sql`
    candidate_pairs AS (
      SELECT
        ed.id AS "erveDispatchId",
        ed.erve_dispatch_number AS "erveDispatchNumber",
        ed.dispatch_date AS "dispatchDate",
        sol.id AS "saleOrderLineId",
        sol.sale_order_id AS "saleOrderId",
        so.sale_order_number AS "saleOrderNumber",
        dist.id AS "distributorId",
        dist.code AS "distributorCode",
        dist.name AS "distributorName",
        style.style_number AS "styleNumber",
        style.style_name AS "styleName",
        size.code AS "sizeCode",
        size.label AS "sizeLabel",
        SUM(fpcl.quantity) AS "dispatchedQuantity"
      FROM factory_packing_carton_lines fpcl
      INNER JOIN factory_packing_cartons fpc ON fpc.id = fpcl.carton_id
      INNER JOIN sale_order_lines sol ON sol.id = fpcl.sale_order_line_id
      INNER JOIN sale_orders so ON so.id = sol.sale_order_id
      INNER JOIN styles style ON style.id = sol.style_id
      INNER JOIN sizes size ON size.id = sol.size_id
      INNER JOIN sale_order_destinations sod ON sod.id = sol.destination_id
      INNER JOIN sale_order_distributors sodist ON sodist.id = sod.sale_order_distributor_id
      INNER JOIN distributors dist ON dist.id = sodist.distributor_id
      -- ErveDispatch.ervePackingListId is unique, so a carton's packing list
      -- resolves to at most one Erve Dispatch; a carton still sitting in a
      -- Factory Packing List with no Erve Dispatch yet (fpc.erve_packing_list_id
      -- IS NULL) is excluded here by the INNER JOIN, same as the old code's
      -- "packed but not yet Erve-dispatched — no consignment position exists
      -- yet" early-continue.
      INNER JOIN erve_dispatches ed ON ed.erve_packing_list_id = fpc.erve_packing_list_id
      WHERE fpc.retired_at IS NULL
        AND sodist.purchase_mode = 'SALE_RETURN'
        AND (${distributorId}::text IS NULL OR sodist.distributor_id = ${distributorId})
      GROUP BY ed.id, ed.erve_dispatch_number, ed.dispatch_date, sol.id, sol.sale_order_id,
               so.sale_order_number, dist.id, dist.code, dist.name, style.style_number,
               style.style_name, size.code, size.label
    ),
    pair_components AS (
      SELECT
        cp.*,
        COALESCE(edl.received_quantity, 0) AS "receivedQuantity",
        COALESCE(sold.quantity_sold, 0) AS "actualSoldQuantity",
        COALESCE(ret.received_quantity, 0) AS "returnedQuantity",
        COALESCE(ret.approved_quantity, 0) AS "approvedAwaitingReceiptQuantity",
        COALESCE(ret.requested_quantity, 0) AS "pendingRequestedQuantity"
      FROM candidate_pairs cp
      LEFT JOIN erve_dispatch_delivery_lines edl
        ON edl.erve_dispatch_id = cp."erveDispatchId" AND edl.sale_order_line_id = cp."saleOrderLineId"
      LEFT JOIN (
        SELECT erve_dispatch_id, sale_order_line_id, SUM(quantity_sold) AS quantity_sold
        FROM distributor_sales_report_lines
        GROUP BY erve_dispatch_id, sale_order_line_id
      ) sold ON sold.erve_dispatch_id = cp."erveDispatchId" AND sold.sale_order_line_id = cp."saleOrderLineId"
      LEFT JOIN (
        SELECT
          drl.erve_dispatch_id,
          drl.sale_order_line_id,
          SUM(CASE WHEN dr.status = 'RECEIVED' THEN drl.received_quantity ELSE 0 END) AS received_quantity,
          SUM(CASE WHEN dr.status = 'APPROVED' THEN drl.approved_quantity ELSE 0 END) AS approved_quantity,
          SUM(CASE WHEN dr.status = 'SUBMITTED' THEN drl.requested_quantity ELSE 0 END) AS requested_quantity
        FROM distributor_return_lines drl
        INNER JOIN distributor_returns dr ON dr.id = drl.distributor_return_id
        WHERE dr.status IN ('RECEIVED', 'APPROVED', 'SUBMITTED')
        GROUP BY drl.erve_dispatch_id, drl.sale_order_line_id
      ) ret ON ret.erve_dispatch_id = cp."erveDispatchId" AND ret.sale_order_line_id = cp."saleOrderLineId"
    )
  `;
}

interface RawPositionRow {
  erveDispatchId: string;
  erveDispatchNumber: string;
  dispatchDate: Date | string;
  saleOrderId: string;
  saleOrderNumber: string;
  distributorId: string;
  distributorCode: string;
  distributorName: string;
  saleOrderLineId: string;
  styleNumber: string;
  styleName: string;
  sizeCode: string;
  sizeLabel: string;
  dispatchedQuantity: bigint | number;
  receivedQuantity: bigint | number;
  actualSoldQuantity: bigint | number;
  returnedQuantity: bigint | number;
  approvedAwaitingReceiptQuantity: bigint | number;
  pendingRequestedQuantity: bigint | number;
}

function toPositionRow(row: RawPositionRow): SaleOrReturnPositionRow {
  const components = {
    receivedQuantity: Number(row.receivedQuantity ?? 0),
    actualSoldQuantity: Number(row.actualSoldQuantity ?? 0),
    returnedQuantity: Number(row.returnedQuantity ?? 0),
    approvedAwaitingReceiptQuantity: Number(row.approvedAwaitingReceiptQuantity ?? 0),
    pendingRequestedQuantity: Number(row.pendingRequestedQuantity ?? 0),
  };
  const availability = computeAvailability(components);
  const dispatchDate =
    row.dispatchDate instanceof Date
      ? row.dispatchDate.toISOString()
      : new Date(row.dispatchDate).toISOString();

  return {
    erveDispatchId: row.erveDispatchId,
    erveDispatchNumber: row.erveDispatchNumber,
    dispatchDate,
    saleOrderId: row.saleOrderId,
    saleOrderNumber: row.saleOrderNumber,
    distributor: { id: row.distributorId, code: row.distributorCode, name: row.distributorName },
    saleOrderLineId: row.saleOrderLineId,
    styleNumber: row.styleNumber,
    styleName: row.styleName,
    sizeCode: row.sizeCode,
    sizeLabel: row.sizeLabel,
    dispatchedQuantity: Number(row.dispatchedQuantity ?? 0),
    ...components,
    remainingWithDistributor: availability.remainingWithDistributor,
    returnableQuantity: availability.availableForNewReturn,
  };
}

export interface PositionCursor {
  erveDispatchId: string;
  saleOrderLineId: string;
}

// Mirrors job-orders.service.ts's encodeQualityWorkCursor/decodeQualityWorkCursor
// convention for a synthetic (non-single-id) pagination grain.
export function encodePositionCursor(cursor: PositionCursor): string {
  return Buffer.from(`${cursor.erveDispatchId}:${cursor.saleOrderLineId}`, 'utf8').toString('base64url');
}

export function decodePositionCursor(raw: string): PositionCursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separatorIndex = decoded.lastIndexOf(':');
  const erveDispatchId = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
  const saleOrderLineId = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';
  if (!erveDispatchId || !saleOrderLineId) {
    throw HttpError.badRequest('Invalid Sale-or-Return position cursor');
  }
  return { erveDispatchId, saleOrderLineId };
}

export interface SaleOrReturnPositionPageParams {
  distributorId?: string;
  onlyWithRemaining?: boolean;
  cursor?: string;
  limit: number;
}

/**
 * Bounded, keyset-paginated candidate page — replaces the old "fetch every
 * historical non-retired SALE_RETURN carton line, group in a Node Map,
 * build an OR array of every pair, run five groupBys, filter in JS" path.
 * Ordering is `(erveDispatchId, saleOrderLineId)` descending — ULIDs are
 * roughly time-sortable and globally unique, so this is a fully
 * deterministic order even when business dates tie, and the composite
 * cursor never needs a third tie-break column.
 */
export async function listSaleOrReturnPositionsPage(
  params: SaleOrReturnPositionPageParams,
): Promise<PaginatedResponse<SaleOrReturnPositionRow>> {
  const cursor = params.cursor ? decodePositionCursor(params.cursor) : null;
  const onlyWithRemaining = params.onlyWithRemaining === true;
  const cte = buildPositionComponentsCte(params.distributorId ?? null);

  const cursorCondition = cursor
    ? Prisma.sql`AND ("erveDispatchId", "saleOrderLineId") < (${cursor.erveDispatchId}, ${cursor.saleOrderLineId})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RawPositionRow[]>(Prisma.sql`
    WITH ${cte}
    SELECT *
    FROM pair_components
    WHERE
      (${onlyWithRemaining}::boolean = FALSE OR ("receivedQuantity" - "actualSoldQuantity" - "returnedQuantity") > 0)
      ${cursorCondition}
    ORDER BY "erveDispatchId" DESC, "saleOrderLineId" DESC
    LIMIT ${params.limit + 1}
  `);

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const items = page.map(toPositionRow);
  const last = items.at(-1);
  return {
    items,
    pageInfo: {
      limit: params.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodePositionCursor({ erveDispatchId: last.erveDispatchId, saleOrderLineId: last.saleOrderLineId })
          : null,
    },
  };
}

export interface SaleOrReturnAggregateParams {
  distributorId?: string;
}

/**
 * Full-history total of `remainingWithDistributor` across every eligible
 * position (dashboard RPT1 6.1 "remaining with distributors" figure) —
 * aggregated entirely in Postgres via SUM, never by loading one row per
 * position into Node. No row-count cap: a management total must reflect
 * every historical position, not a bounded recent slice.
 */
export async function getSaleOrReturnRemainingTotal(params: SaleOrReturnAggregateParams): Promise<number> {
  const cte = buildPositionComponentsCte(params.distributorId ?? null);
  const [row] = await prisma.$queryRaw<Array<{ remaining: bigint | number | null }>>(Prisma.sql`
    WITH ${cte}
    SELECT COALESCE(SUM("receivedQuantity" - "actualSoldQuantity" - "returnedQuantity"), 0) AS remaining
    FROM pair_components
  `);
  return Number(row?.remaining ?? 0);
}

export interface SaleOrReturnGroupedTotalsParams {
  distributorId?: string;
  groupByStyle?: boolean;
}

export interface SaleOrReturnGroupedTotalRow {
  distributor: { id: string; code: string; name: string };
  style?: { id: string; styleNumber: string; styleName: string };
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
}

interface RawGroupedRow {
  distributorId: string;
  distributorCode: string;
  distributorName: string;
  styleNumber: string | null;
  styleName: string | null;
  representativeSaleOrderLineId: string | null;
  receivedQuantity: bigint | number;
  actualSoldQuantity: bigint | number;
  returnedQuantity: bigint | number;
  approvedAwaitingReceiptQuantity: bigint | number;
  pendingRequestedQuantity: bigint | number;
}

/**
 * Full-history totals grouped by distributor (or distributor+style) for
 * RPT1 6.10's Sale-or-Return report — replaces fetching every position row
 * and accumulating the group sums in a Node Map. Grouping cardinality is
 * bounded by the number of distinct distributors (x styles), not by
 * transaction history depth, and GROUP BY SUM() runs entirely in Postgres.
 * `style.id` has no real identity in the grouped grain (a group spans every
 * size/dispatch of that style); it was previously an arbitrary
 * saleOrderLineId picked by Map insertion order (unused by any consumer —
 * see DistributorCharts.tsx) and is now the deterministic MIN of that set.
 */
export async function getSaleOrReturnGroupedTotals(
  params: SaleOrReturnGroupedTotalsParams,
): Promise<SaleOrReturnGroupedTotalRow[]> {
  const cte = buildPositionComponentsCte(params.distributorId ?? null);
  const rows = params.groupByStyle
    ? await prisma.$queryRaw<RawGroupedRow[]>(Prisma.sql`
        WITH ${cte}
        SELECT
          "distributorId", "distributorCode", "distributorName",
          "styleNumber", "styleName",
          MIN("saleOrderLineId") AS "representativeSaleOrderLineId",
          SUM("receivedQuantity") AS "receivedQuantity",
          SUM("actualSoldQuantity") AS "actualSoldQuantity",
          SUM("returnedQuantity") AS "returnedQuantity",
          SUM("approvedAwaitingReceiptQuantity") AS "approvedAwaitingReceiptQuantity",
          SUM("pendingRequestedQuantity") AS "pendingRequestedQuantity"
        FROM pair_components
        GROUP BY "distributorId", "distributorCode", "distributorName", "styleNumber", "styleName"
        ORDER BY "distributorCode" ASC, "styleNumber" ASC
      `)
    : await prisma.$queryRaw<RawGroupedRow[]>(Prisma.sql`
        WITH ${cte}
        SELECT
          "distributorId", "distributorCode", "distributorName",
          NULL AS "styleNumber", NULL AS "styleName", NULL AS "representativeSaleOrderLineId",
          SUM("receivedQuantity") AS "receivedQuantity",
          SUM("actualSoldQuantity") AS "actualSoldQuantity",
          SUM("returnedQuantity") AS "returnedQuantity",
          SUM("approvedAwaitingReceiptQuantity") AS "approvedAwaitingReceiptQuantity",
          SUM("pendingRequestedQuantity") AS "pendingRequestedQuantity"
        FROM pair_components
        GROUP BY "distributorId", "distributorCode", "distributorName"
        ORDER BY "distributorCode" ASC
      `);

  return rows.map((row) => ({
    distributor: { id: row.distributorId, code: row.distributorCode, name: row.distributorName },
    style:
      params.groupByStyle && row.styleNumber && row.styleName && row.representativeSaleOrderLineId
        ? { id: row.representativeSaleOrderLineId, styleNumber: row.styleNumber, styleName: row.styleName }
        : undefined,
    receivedQuantity: Number(row.receivedQuantity ?? 0),
    actualSoldQuantity: Number(row.actualSoldQuantity ?? 0),
    returnedQuantity: Number(row.returnedQuantity ?? 0),
    approvedAwaitingReceiptQuantity: Number(row.approvedAwaitingReceiptQuantity ?? 0),
    pendingRequestedQuantity: Number(row.pendingRequestedQuantity ?? 0),
  }));
}
