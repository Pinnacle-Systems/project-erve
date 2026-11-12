import { Prisma } from '../../db/prisma.js';
import type { RetailStoreInventoryPurchaseMode } from '@erve/types';

// ---------------------------------------------------------------------------
// A6 / ISS-088 — Retail Store Inventory SQL building blocks.
//
// Grain of every calculation is the existing authoritative source position
// (erve_dispatch_id, sale_order_line_id), exactly as the Sale-or-Return
// position (sale-or-return-position-query.service.ts) and the A5
// reconciliation (reconciliation-query.ts) use it. Everything is aggregated
// from that grain inside PostgreSQL; nothing is persisted and no ledger is
// created.
//
// Eligibility ("only physically dispatched goods"): non-retired
// FactoryPackingCartons that belong to an Erve Packing List which is
// DISPATCHED *and* has its ErveDispatch row (INNER JOIN). Cartons that are only
// packed, allocated or sitting in an OPEN/FINALIZED list never appear.
//
// Retail Store identity: the stable `sale_order_destinations.retail_store_id`.
// A destination without one (pre-ISS-100 history) becomes its own group keyed
// by that destination id — never matched or merged by name/address.
// Purchase mode is the commercial source-line fact (`sale_order_distributors`),
// so a Style shipped under both modes is two separate groups.
// ---------------------------------------------------------------------------

export interface InventoryScopeFilters {
  /** Row-level scope; null only for broad viewers who did not select a Distributor. */
  distributorId: string | null;
  purchaseMode?: RetailStoreInventoryPurchaseMode | null;
  /** Free-text over the master Store name/code and the destination's own snapshot label/code. */
  storeSearch?: string | null;
  /** Exact Store group (`S:<id>` or `D:<id>`). */
  storeKey?: string | null;
  /** Exact set of Store groups (the current page). */
  storeKeys?: string[] | null;
  styleSearch?: string | null;
  styleId?: string | null;
  sizeId?: string | null;
}

/** The one definition of a Store group key; used in SELECT and WHERE alike. */
const STORE_KEY_SQL = Prisma.sql`CASE WHEN sod.retail_store_id IS NOT NULL THEN 'S:' || sod.retail_store_id ELSE 'D:' || sod.id END`;

const nullable = (value: string | null | undefined) => value ?? null;

/** `pairs`: one row per (Dispatch, Sale Order line) with its physically shipped quantity. */
function pairsCte(f: InventoryScopeFilters): Prisma.Sql {
  const storeKeys = f.storeKeys && f.storeKeys.length > 0 ? f.storeKeys : null;
  return Prisma.sql`
    pairs AS (
      SELECT
        ed.id AS dispatch_id,
        ed.erve_dispatch_number AS dispatch_number,
        ed.dispatch_date AS dispatch_date,
        pl.id AS packing_list_id,
        sol.id AS sol_id,
        sol.sale_order_id AS sale_order_id,
        sol.style_id AS style_id,
        sol.size_id AS size_id,
        sodist.purchase_mode::text AS purchase_mode,
        sodist.distributor_id AS distributor_id,
        sod.id AS destination_id,
        sod.retail_store_id AS retail_store_id,
        ${STORE_KEY_SQL} AS store_key,
        SUM(fpcl.quantity)::bigint AS shipped
      FROM factory_packing_carton_lines fpcl
      INNER JOIN factory_packing_cartons fpc ON fpc.id = fpcl.carton_id AND fpc.retired_at IS NULL
      INNER JOIN erve_packing_lists pl ON pl.id = fpc.erve_packing_list_id AND pl.status = 'DISPATCHED'
      INNER JOIN erve_dispatches ed ON ed.erve_packing_list_id = pl.id
      INNER JOIN sale_order_lines sol ON sol.id = fpcl.sale_order_line_id
      INNER JOIN styles st ON st.id = sol.style_id
      INNER JOIN sale_order_destinations sod ON sod.id = sol.destination_id
      INNER JOIN sale_order_distributors sodist ON sodist.id = sod.sale_order_distributor_id
      LEFT JOIN retail_stores rs ON rs.id = sod.retail_store_id
      WHERE (${nullable(f.distributorId)}::text IS NULL OR sodist.distributor_id = ${nullable(f.distributorId)})
        AND (${nullable(f.purchaseMode)}::text IS NULL OR sodist.purchase_mode::text = ${nullable(f.purchaseMode)})
        AND (${nullable(f.storeKey)}::text IS NULL OR ${STORE_KEY_SQL} = ${nullable(f.storeKey)})
        AND (${storeKeys}::text[] IS NULL OR ${STORE_KEY_SQL} = ANY(${storeKeys}::text[]))
        AND (${nullable(f.styleId)}::text IS NULL OR sol.style_id = ${nullable(f.styleId)})
        AND (${nullable(f.sizeId)}::text IS NULL OR sol.size_id = ${nullable(f.sizeId)})
        AND (${nullable(f.styleSearch)}::text IS NULL
          OR strpos(lower(st.style_number), lower(${nullable(f.styleSearch)})) > 0
          OR strpos(lower(st.style_name), lower(${nullable(f.styleSearch)})) > 0)
        AND (${nullable(f.storeSearch)}::text IS NULL
          OR strpos(lower(COALESCE(rs.name, '')), lower(${nullable(f.storeSearch)})) > 0
          OR strpos(lower(COALESCE(rs.code, '')), lower(${nullable(f.storeSearch)})) > 0
          OR strpos(lower(COALESCE(sod.label, '')), lower(${nullable(f.storeSearch)})) > 0
          OR strpos(lower(COALESCE(sod.store_code, '')), lower(${nullable(f.storeSearch)})) > 0)
      GROUP BY ed.id, ed.erve_dispatch_number, ed.dispatch_date, pl.id, sol.id, sol.sale_order_id,
               sol.style_id, sol.size_id, sodist.purchase_mode, sodist.distributor_id, sod.id, sod.retail_store_id
      HAVING SUM(fpcl.quantity) > 0
    )`;
}

/**
 * `pair_components`: `pairs` plus every evidence/downstream fact at the same
 * grain. Sales and Returns are pre-aggregated per pair, restricted to the
 * Dispatches already selected (never a whole-table scan), then LEFT JOINed —
 * one pass, no per-row follow-up queries.
 */
export function pairComponentsCte(f: InventoryScopeFilters): Prisma.Sql {
  return Prisma.sql`
    ${pairsCte(f)},
    pair_components AS (
      SELECT
        p.*,
        r.id AS receipt_id,
        r.ledger_disposition::text AS receipt_disposition,
        r.received_at AS receipt_received_at,
        rl.id AS attestation_line_id,
        rl.received_quantity AS attested_qty,
        edl.received_quantity AS ledger_qty,
        ed.delivery_confirmation_source::text AS ledger_source,
        COALESCE(sold.quantity_sold, 0)::bigint AS sold_qty,
        COALESCE(ret.received_quantity, 0)::bigint AS returned_qty,
        COALESCE(ret.approved_quantity, 0)::bigint AS approved_qty,
        COALESCE(ret.requested_quantity, 0)::bigint AS pending_qty
      FROM pairs p
      INNER JOIN erve_dispatches ed ON ed.id = p.dispatch_id
      LEFT JOIN erve_dispatch_distributor_receipts r ON r.erve_dispatch_id = p.dispatch_id
      LEFT JOIN erve_dispatch_distributor_receipt_lines rl
        ON rl.receipt_id = r.id AND rl.sale_order_line_id = p.sol_id
      LEFT JOIN erve_dispatch_delivery_lines edl
        ON edl.erve_dispatch_id = p.dispatch_id AND edl.sale_order_line_id = p.sol_id
      LEFT JOIN (
        SELECT s.erve_dispatch_id, s.sale_order_line_id, SUM(s.quantity_sold) AS quantity_sold
        FROM distributor_sales_report_lines s
        WHERE s.erve_dispatch_id IN (SELECT dispatch_id FROM pairs)
        GROUP BY s.erve_dispatch_id, s.sale_order_line_id
      ) sold ON sold.erve_dispatch_id = p.dispatch_id AND sold.sale_order_line_id = p.sol_id
      LEFT JOIN (
        SELECT drl.erve_dispatch_id, drl.sale_order_line_id,
          SUM(CASE WHEN dr.status = 'RECEIVED' THEN drl.received_quantity ELSE 0 END) AS received_quantity,
          SUM(CASE WHEN dr.status = 'APPROVED' THEN drl.approved_quantity ELSE 0 END) AS approved_quantity,
          SUM(CASE WHEN dr.status = 'SUBMITTED' THEN drl.requested_quantity ELSE 0 END) AS requested_quantity
        FROM distributor_return_lines drl
        INNER JOIN distributor_returns dr ON dr.id = drl.distributor_return_id
        WHERE dr.status IN ('RECEIVED', 'APPROVED', 'SUBMITTED')
          AND drl.erve_dispatch_id IN (SELECT dispatch_id FROM pairs)
        GROUP BY drl.erve_dispatch_id, drl.sale_order_line_id
      ) ret ON ret.erve_dispatch_id = p.dispatch_id AND ret.sale_order_line_id = p.sol_id
    )`;
}

/**
 * Additive component sums over `pair_components` (aliases are the snake_case
 * keys rawComponentsFromRow reads). "Attested" requires the A4 receipt *line*
 * for the pair; a Dispatch without one is awaiting confirmation, and a missing
 * ledger row is NULL (never zero) so counts can tell "none" from "0".
 * Sales/Returns are only meaningful for SALE_RETURN sources.
 */
export const SUMS_SQL = Prisma.sql`
  COUNT(*)::int AS source_count,
  COALESCE(SUM(shipped), 0)::bigint AS shipped,
  COALESCE(SUM(CASE WHEN attestation_line_id IS NULL THEN shipped ELSE 0 END), 0)::bigint AS awaiting,
  COALESCE(SUM(CASE WHEN attestation_line_id IS NOT NULL THEN shipped ELSE 0 END), 0)::bigint AS attested_shipped,
  COALESCE(SUM(attested_qty), 0)::bigint AS attested_received,
  COUNT(attestation_line_id)::int AS attested_count,
  COALESCE(SUM(CASE WHEN attestation_line_id IS NOT NULL THEN GREATEST(0, shipped - attested_qty) ELSE 0 END), 0)::bigint AS shortage,
  COALESCE(SUM(ledger_qty), 0)::bigint AS ledger,
  COUNT(ledger_qty)::int AS ledger_count,
  COALESCE(SUM(CASE WHEN ledger_source = 'DISTRIBUTOR_CONFIRMED' THEN ledger_qty ELSE 0 END), 0)::bigint AS ledger_distributor,
  COALESCE(SUM(CASE WHEN ledger_source = 'USER_CONFIRMED' THEN ledger_qty ELSE 0 END), 0)::bigint AS ledger_user,
  COALESCE(SUM(CASE WHEN ledger_source = 'LEGACY_ASSUMED_FULL_RECEIPT' THEN ledger_qty ELSE 0 END), 0)::bigint AS ledger_legacy,
  COALESCE(SUM(CASE WHEN ledger_source IS NULL THEN ledger_qty ELSE 0 END), 0)::bigint AS ledger_unspecified,
  (COUNT(*) FILTER (WHERE attestation_line_id IS NOT NULL AND ledger_qty IS NOT NULL AND attested_qty <> ledger_qty))::int AS discrepancy,
  COALESCE(SUM(CASE WHEN purchase_mode = 'SALE_RETURN' THEN sold_qty ELSE 0 END), 0)::bigint AS sold,
  COALESCE(SUM(CASE WHEN purchase_mode = 'SALE_RETURN' THEN returned_qty ELSE 0 END), 0)::bigint AS returned,
  COALESCE(SUM(CASE WHEN purchase_mode = 'SALE_RETURN' THEN approved_qty ELSE 0 END), 0)::bigint AS approved,
  COALESCE(SUM(CASE WHEN purchase_mode = 'SALE_RETURN' THEN pending_qty ELSE 0 END), 0)::bigint AS pending`;

// ----- Store listing ---------------------------------------------------------

export interface StoreCursor {
  distributorSort: string;
  distributorId: string;
  storeSort: string;
  storeKey: string;
}

export interface StoreRow {
  store_key: string;
  distributor_id: string;
  distributor_code: string;
  distributor_name: string;
  retail_store_id: string | null;
  store_code: string | null;
  store_name: string;
  store_city: string | null;
  store_state: string | null;
  store_status: 'ACTIVE' | 'INACTIVE' | null;
  dispatch_count: number;
  distributor_sort: string;
  store_sort: string;
}

/**
 * One page of Store groups, keyset-ordered by
 * (distributor name, distributor id, store name, store key) — a total order, so
 * a page boundary can never skip or repeat a Store. All filtering has already
 * happened in `pairs`; this only groups, orders and limits.
 */
export function storePageQuery(f: InventoryScopeFilters, cursor: StoreCursor | null, limit: number): Prisma.Sql {
  const cursorCondition = cursor
    ? Prisma.sql`WHERE (distributor_sort, distributor_id, store_sort, store_key) > (${cursor.distributorSort}, ${cursor.distributorId}, ${cursor.storeSort}, ${cursor.storeKey})`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${pairsCte(f)},
    stores AS (
      SELECT p.store_key, p.distributor_id, p.retail_store_id,
        MIN(p.destination_id) AS destination_id,
        COUNT(DISTINCT p.dispatch_id)::int AS dispatch_count
      FROM pairs p
      GROUP BY p.store_key, p.distributor_id, p.retail_store_id
    ),
    named AS (
      SELECT s.store_key, s.distributor_id, d.code AS distributor_code, d.name AS distributor_name,
        s.retail_store_id,
        COALESCE(rs.code, dest.store_code) AS store_code,
        COALESCE(rs.name, dest.label, dest.store_code, 'Unnamed destination') AS store_name,
        COALESCE(rs.city, dest.city) AS store_city,
        COALESCE(rs.state, dest.state) AS store_state,
        rs.status::text AS store_status,
        s.dispatch_count,
        lower(d.name) AS distributor_sort,
        lower(COALESCE(rs.name, dest.label, dest.store_code, 'Unnamed destination')) AS store_sort
      FROM stores s
      INNER JOIN distributors d ON d.id = s.distributor_id
      LEFT JOIN retail_stores rs ON rs.id = s.retail_store_id
      LEFT JOIN sale_order_destinations dest ON dest.id = s.destination_id
    )
    SELECT * FROM named
    ${cursorCondition}
    ORDER BY distributor_sort, distributor_id, store_sort, store_key
    LIMIT ${limit + 1}`;
}

// ----- Cells and totals ------------------------------------------------------

/** Aggregated Style x Size x purchase-mode cells for the (already page-restricted) Store groups. */
export function cellsQuery(f: InventoryScopeFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(f)}
    SELECT store_key, style_id, size_id, purchase_mode, ${SUMS_SQL}
    FROM pair_components
    GROUP BY store_key, style_id, size_id, purchase_mode`;
}

/** Totals over *every* matching record, one row per purchase mode (their semantics differ). */
export function totalsByModeQuery(f: InventoryScopeFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(f)}
    SELECT purchase_mode, ${SUMS_SQL}
    FROM pair_components
    GROUP BY purchase_mode`;
}

export function distinctCountsQuery(f: InventoryScopeFilters): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairsCte(f)}
    SELECT COUNT(DISTINCT store_key)::int AS store_count, COUNT(DISTINCT dispatch_id)::int AS dispatch_count
    FROM pairs`;
}

// ----- Source drilldown ------------------------------------------------------

export interface SourceCursor {
  dispatchDate: string;
  dispatchId: string;
  saleOrderLineId: string;
}

/**
 * Contributing (Dispatch, Sale Order line) positions for one Store group /
 * Style / purchase mode (optionally one Size). The page is cut in an inner CTE
 * first so the per-row QR lookup and descriptive joins only ever touch
 * `limit + 1` rows.
 */
export function sourcesQuery(f: InventoryScopeFilters, cursor: SourceCursor | null, limit: number): Prisma.Sql {
  const cursorCondition = cursor
    ? Prisma.sql`WHERE (dispatch_date, dispatch_id, sol_id) < (${cursor.dispatchDate}::date, ${cursor.dispatchId}, ${cursor.saleOrderLineId})`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${pairComponentsCte(f)},
    page AS (
      SELECT * FROM pair_components
      ${cursorCondition}
      ORDER BY dispatch_date DESC, dispatch_id DESC, sol_id DESC
      LIMIT ${limit + 1}
    )
    SELECT pg.*,
      so.sale_order_number,
      pl.erve_packing_list_number,
      pl.destination_label AS pl_label, pl.destination_store_code AS pl_store_code,
      pl.destination_address_line1 AS pl_address1, pl.destination_city AS pl_city,
      pl.destination_state AS pl_state, pl.destination_postal_code AS pl_postal_code,
      sod.label AS sod_label, sod.store_code AS sod_store_code, sod.address_line1 AS sod_address1,
      sod.city AS sod_city, sod.state AS sod_state, sod.postal_code AS sod_postal_code,
      st.style_number, st.style_name, sz.code AS size_code, sz.label AS size_label,
      dist.code AS distributor_code, dist.name AS distributor_name,
      qr.carton_count, qr.confirmed_count
    FROM page pg
    INNER JOIN sale_orders so ON so.id = pg.sale_order_id
    INNER JOIN erve_packing_lists pl ON pl.id = pg.packing_list_id
    INNER JOIN sale_order_destinations sod ON sod.id = pg.destination_id
    INNER JOIN styles st ON st.id = pg.style_id
    INNER JOIN sizes sz ON sz.id = pg.size_id
    INNER JOIN distributors dist ON dist.id = pg.distributor_id
    LEFT JOIN LATERAL (
      SELECT COUNT(DISTINCT c.id)::int AS carton_count, COUNT(DISTINCT dc.id)::int AS confirmed_count
      FROM factory_packing_carton_lines l
      INNER JOIN factory_packing_cartons c ON c.id = l.carton_id AND c.retired_at IS NULL
        AND c.erve_packing_list_id = pg.packing_list_id
      LEFT JOIN carton_delivery_confirmations dc ON dc.carton_id = c.id AND dc.dispatch_id = pg.dispatch_id
      WHERE l.sale_order_line_id = pg.sol_id
    ) qr ON true
    ORDER BY pg.dispatch_date DESC, pg.dispatch_id DESC, pg.sol_id DESC`;
}
