import { Prisma } from '../../db/prisma.js';
import {
  SUMS_SQL,
  pairComponentsCte,
  sourcesQuery,
  type InventoryScopeFilters,
  type SourceCursor,
} from './retail-store-inventory-query.js';

// ---------------------------------------------------------------------------
// Sale-or-Return Stock - Style-first consolidated read model (SQL builders).
//
// This module re-groups the A6 `pair_components` CTE (retail-store-inventory-
// query.ts) - it does not re-derive any quantity. That CTE already carries, per
// (Erve Dispatch, Sale Order line) source position: the physical shipped
// quantity, the A4 Distributor receipt evidence (NULL when absent, never 0), the
// received ledger in use, and the Sales Report / Return components, with stable
// Style, Size, Distributor and Retail Store identities. Every query below
// aggregates it entirely inside PostgreSQL over the whole qualifying history;
// nothing is loaded per-position into Node and no page can change a total.
//
// SALE_RETURN only: `purchaseMode` is pinned here so OUTRIGHT shipments can never
// reach a consignment balance, whatever a caller passes.
//
// Aggregate first, then join the descriptive tables: SUMS_SQL references bare
// column names, and `distributors` / `styles` carry columns of their own (for
// example `distributors.purchase_mode`), so joining them *before* aggregating
// would make those references ambiguous.
// ---------------------------------------------------------------------------

export interface StockScope {
  /** Row-level scope; null only for internal viewers who did not pick a Distributor. */
  distributorId: string | null;
  styleSearch?: string | null;
  styleId?: string | null;
  sizeId?: string | null;
  storeKey?: string | null;
}

function filtersFor(scope: StockScope): InventoryScopeFilters {
  return {
    distributorId: scope.distributorId,
    purchaseMode: 'SALE_RETURN',
    styleSearch: scope.styleSearch ?? null,
    styleId: scope.styleId ?? null,
    sizeId: scope.sizeId ?? null,
    storeKey: scope.storeKey ?? null,
  };
}

// ----- Level 1: Styles -------------------------------------------------------

export interface StyleCursor {
  styleSort: string;
  styleId: string;
}

/**
 * One page of Styles, keyset-ordered by (lower(style number), style id) - a total
 * order, so a page boundary can never skip or repeat a Style. Pagination operates
 * on the aggregated Styles, never on the underlying dispatch positions.
 */
export function stylePageQuery(scope: StockScope, cursor: StyleCursor | null, limit: number): Prisma.Sql {
  const cursorCondition = cursor
    ? Prisma.sql`WHERE (style_sort, style_id) > (${cursor.styleSort}, ${cursor.styleId})`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${pairComponentsCte(filtersFor(scope))},
    per_style AS (
      SELECT style_id,
        COUNT(DISTINCT distributor_id)::int AS distributor_count,
        COUNT(DISTINCT distributor_id || ':' || store_key)::int AS store_count,
        ${SUMS_SQL}
      FROM pair_components
      GROUP BY style_id
    ),
    named AS (
      SELECT ps.*, st.style_number, st.style_name, lower(st.style_number) AS style_sort
      FROM per_style ps
      INNER JOIN styles st ON st.id = ps.style_id
    )
    SELECT * FROM named
    ${cursorCondition}
    ORDER BY style_sort, style_id
    LIMIT ${limit + 1}`;
}

/** Totals over every matching source position - independent of the page being shown. */
export function styleSummaryQuery(scope: StockScope): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(filtersFor(scope))}
    SELECT
      COUNT(DISTINCT style_id)::int AS style_count,
      COUNT(DISTINCT distributor_id)::int AS distributor_count,
      COUNT(DISTINCT distributor_id || ':' || store_key)::int AS store_count,
      ${SUMS_SQL}
    FROM pair_components`;
}

// ----- Level 2: one Style ----------------------------------------------------

/** The Style's consolidated cells, one row per Size. */
export function styleSizeCellsQuery(scope: StockScope): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(filtersFor(scope))}
    SELECT size_id, ${SUMS_SQL}
    FROM pair_components
    GROUP BY size_id`;
}

// ----- Level 3: Distributors, then Stores ------------------------------------

export function styleDistributorsQuery(scope: StockScope): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(filtersFor(scope))},
    per_distributor AS (
      SELECT distributor_id,
        COUNT(DISTINCT store_key)::int AS store_count,
        ${SUMS_SQL}
      FROM pair_components
      GROUP BY distributor_id
    )
    SELECT pd.*, d.code AS distributor_code, d.name AS distributor_name
    FROM per_distributor pd
    INNER JOIN distributors d ON d.id = pd.distributor_id
    ORDER BY lower(d.name), pd.distributor_id`;
}

export interface StockStoreRow {
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
}

/**
 * Store-wise totals for the Style, ordered by (Distributor, Store name, key). A
 * Store is identified by the stable `retail_store_id` (key `S:<id>`); an
 * unmapped historical destination is its own group (`D:<id>`), never matched or
 * merged by name or address - the same identity rule as Retail Store Inventory.
 */
export function styleStoresQuery(scope: StockScope): Prisma.Sql {
  return Prisma.sql`
    WITH ${pairComponentsCte(filtersFor(scope))},
    per_store AS (
      SELECT store_key, distributor_id, retail_store_id,
        MIN(destination_id) AS destination_id,
        ${SUMS_SQL}
      FROM pair_components
      GROUP BY store_key, distributor_id, retail_store_id
    )
    SELECT ps.*,
      d.code AS distributor_code, d.name AS distributor_name,
      COALESCE(rs.code, dest.store_code) AS store_code,
      COALESCE(rs.name, dest.label, dest.store_code, 'Unnamed destination') AS store_name,
      COALESCE(rs.city, dest.city) AS store_city,
      COALESCE(rs.state, dest.state) AS store_state,
      rs.status::text AS store_status
    FROM per_store ps
    INNER JOIN distributors d ON d.id = ps.distributor_id
    LEFT JOIN retail_stores rs ON rs.id = ps.retail_store_id
    LEFT JOIN sale_order_destinations dest ON dest.id = ps.destination_id
    ORDER BY lower(d.name), ps.distributor_id,
      lower(COALESCE(rs.name, dest.label, dest.store_code, 'Unnamed destination')), ps.store_key`;
}

// ----- Level 4: contributing source positions --------------------------------

/**
 * Paginated contributing (Erve Dispatch, Sale Order line) positions. Delegates to
 * the A6 source query so the keyset order and the receipt/ledger/QR evidence are
 * identical to the Retail Store Inventory drill-down.
 */
export function styleSourcesQuery(scope: StockScope, cursor: SourceCursor | null, limit: number): Prisma.Sql {
  return sourcesQuery(filtersFor(scope), cursor, limit);
}
