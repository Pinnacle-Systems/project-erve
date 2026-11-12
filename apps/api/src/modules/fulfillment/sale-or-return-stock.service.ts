import type {
  RetailStoreInventoryMeasures,
  RetailStoreInventorySizeColumn,
  SaleOrReturnStockDistributorBreakdown,
  SaleOrReturnStockSource,
  SaleOrReturnStockSourcesResponse,
  SaleOrReturnStockStoreBreakdown,
  SaleOrReturnStockStoresResponse,
  SaleOrReturnStockStyleDetail,
  SaleOrReturnStockStyleSummary,
  SaleOrReturnStockStylesResponse,
} from '@erve/types';
import { canViewRetailStoreInventory, canViewSaleOrReturnPosition } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import {
  canReadAnyStyleImage,
  stylePrimaryImageIncludeFor,
  toPrimaryImageView,
} from '../master-data/style-images.service.js';
import {
  styleDistributorsQuery,
  stylePageQuery,
  styleSizeCellsQuery,
  styleSourcesQuery,
  styleStoresQuery,
  styleSummaryQuery,
  type StockScope,
  type StockStoreRow,
  type StyleCursor,
} from './sale-or-return-stock-query.js';
import type { SourceCursor } from './retail-store-inventory-query.js';
import { toInventorySource, type SourceRow } from './retail-store-inventory.service.js';
import {
  EMPTY_COMPONENTS,
  addComponents,
  rawComponentsFromRow,
  toMeasures,
  type RawInventoryComponents,
} from './retail-store-inventory-measures.js';
import {
  sourceCursorSchema,
  styleCursorSchema,
  type ListStockStyleSourcesQuery,
  type ListStockStylesQuery,
  type StockStyleScopeQuery,
} from './sale-or-return-stock.validation.js';

// ---------------------------------------------------------------------------
// Sale-or-Return Stock - Style-first consolidated reporting (read-only).
//
// Responsibility split (same as the A6 Retail Store Inventory): this module owns
// authorization, Distributor scoping, pagination and response shaping. Every
// quantity is aggregated by PostgreSQL (sale-or-return-stock-query.ts) at the
// authoritative (erveDispatchId, saleOrderLineId) grain and finalized by the one
// shared computeAvailability() (via toMeasures). There is no stock table, no
// write path, and no FIFO/allocation behavior here.
//
// Hierarchy served (each level fetched on demand, never one request per
// historical transaction):
//   1. GET /styles                          one row per Style (paginated on Styles)
//   2. GET /styles/:styleId                 consolidated native Size matrix + Distributor totals
//   3. GET /styles/:styleId/stores          Store-wise totals (opened per Distributor)
//   4. GET /styles/:styleId/sources         paginated contributing Dispatch / Order positions
// ---------------------------------------------------------------------------

const readOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 30000,
};

/**
 * Row-level Distributor scope, enforced here at the service layer (never only in
 * the UI). A user holding the DISTRIBUTOR role is pinned to its single mapped
 * Distributor and may only ever name that one; every other permitted viewer is an
 * internal reader who may leave the Distributor open (all Distributors
 * consolidated) or filter to one. Fails closed for Factory / Transporter accounts,
 * exactly like Retail Store Inventory.
 */
function resolveScope(actor: CurrentUser, requestedDistributorId?: string): string | null {
  if (!canViewSaleOrReturnPosition(actor) || !canViewRetailStoreInventory(actor)) {
    throw HttpError.forbidden('You do not have permission to view Sale-or-Return stock');
  }
  if (actor.roles.includes('DISTRIBUTOR')) {
    const own = getSoleDistributorId(actor);
    if (requestedDistributorId && requestedDistributorId !== own) {
      throw HttpError.forbidden('You do not have permission to view data for another distributor');
    }
    return own;
  }
  return requestedDistributorId ?? null;
}

/**
 * Same policy as Retail Store Inventory / the Style image endpoints: ADMIN,
 * MERCHANDISER, SENIOR_MANAGEMENT and ACCOUNTANT read any Style image; a
 * Distributor additionally reads them because `resolveScope` pins it to its own
 * Distributor and every Style here comes from that Distributor's own dispatched
 * cartons, so no image of a Style outside its own records is ever referenced.
 */
function canReadStockStyleImages(actor: CurrentUser): boolean {
  return canReadAnyStyleImage(actor) || actor.roles.includes('DISTRIBUTOR');
}

function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decodeCursor<T>(raw: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }): T {
  try {
    const parsed = schema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    if (parsed.success) return parsed.data as T;
  } catch {
    // fall through to the uniform error below
  }
  throw HttpError.badRequest('Invalid cursor');
}

type Row = Record<string, string | number | bigint | null>;
const measuresOf = (row: Row) => toMeasures(rawComponentsFromRow(row), 'SALE_RETURN');

// ----- Level 1 ---------------------------------------------------------------

export async function listStockStyles(
  actor: CurrentUser,
  query: ListStockStylesQuery,
): Promise<SaleOrReturnStockStylesResponse> {
  const distributorId = resolveScope(actor, query.distributorId);
  const scope: StockScope = { distributorId, styleSearch: query.style ?? null };
  const cursor = query.cursor ? decodeCursor<StyleCursor>(query.cursor, styleCursorSchema) : null;

  return prisma.$transaction(async (tx) => {
    const [fetched, summaryRows] = await Promise.all([
      tx.$queryRaw<Array<Row & { style_id: string; style_number: string; style_name: string; style_sort: string }>>(
        stylePageQuery(scope, cursor, query.limit),
      ),
      tx.$queryRaw<Row[]>(styleSummaryQuery(scope)),
    ]);
    const hasMore = fetched.length > query.limit;
    const page = hasMore ? fetched.slice(0, query.limit) : fetched;

    const images = page.length
      ? await tx.style.findMany({
          where: { id: { in: page.map((row) => row.style_id) } },
          select: { id: true, images: stylePrimaryImageIncludeFor(canReadStockStyleImages(actor)) },
        })
      : [];
    const imagesByStyle = new Map(images.map((style) => [style.id, style.images]));

    const items: SaleOrReturnStockStyleSummary[] = page.map((row) => ({
      styleId: row.style_id,
      styleNumber: row.style_number,
      styleName: row.style_name,
      primaryImage: toPrimaryImageView(imagesByStyle.get(row.style_id) ?? []),
      distributorCount: Number(row.distributor_count ?? 0),
      storeCount: Number(row.store_count ?? 0),
      measures: measuresOf(row),
    }));

    const summary = summaryRows[0] ?? {};
    const last = page.at(-1);
    return {
      items,
      summary: {
        styleCount: Number(summary.style_count ?? 0),
        distributorCount: Number(summary.distributor_count ?? 0),
        storeCount: Number(summary.store_count ?? 0),
        measures: measuresOf(summary),
      },
      pageInfo: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ styleSort: last.style_sort, styleId: last.style_id } satisfies StyleCursor)
            : null,
      },
    };
  }, readOptions);
}

// ----- Level 2 (+ Distributor totals) ----------------------------------------

export async function getStockStyleDetail(
  actor: CurrentUser,
  styleId: string,
  query: StockStyleScopeQuery,
): Promise<SaleOrReturnStockStyleDetail> {
  const distributorId = resolveScope(actor, query.distributorId);
  const scope: StockScope = { distributorId, styleId };

  return prisma.$transaction(async (tx) => {
    const [cellRows, distributorRows] = await Promise.all([
      tx.$queryRaw<Array<Row & { size_id: string }>>(styleSizeCellsQuery(scope)),
      tx.$queryRaw<Array<Row & { distributor_id: string; distributor_code: string; distributor_name: string }>>(
        styleDistributorsQuery(scope),
      ),
    ]);
    // No qualifying stock in scope. One uniform 404 for "no such Style", "not yours" and
    // "nothing in this filter", so a Distributor can never probe for another's Styles.
    if (cellRows.length === 0) throw HttpError.notFound('No Sale-or-Return stock found for this Style');

    const [style, styleSizes] = await Promise.all([
      tx.style.findUnique({
        where: { id: styleId },
        select: {
          id: true,
          styleNumber: true,
          styleName: true,
          images: stylePrimaryImageIncludeFor(canReadStockStyleImages(actor)),
        },
      }),
      tx.styleSize.findMany({
        where: { styleId, status: 'ACTIVE', size: { status: 'ACTIVE' } },
        select: { sizeId: true },
      }),
    ]);
    if (!style) throw HttpError.notFound('No Sale-or-Return stock found for this Style');

    const activeSizeIds = new Set(styleSizes.map((s) => s.sizeId));
    const sizeMaster = await tx.size.findMany({
      where: { id: { in: [...new Set([...activeSizeIds, ...cellRows.map((c) => c.size_id)])] } },
      select: { id: true, code: true, label: true, sortOrder: true },
    });
    const sizeById = new Map(sizeMaster.map((s) => [s.id, s]));

    // The Style's own native Size columns: its active Sizes plus any retired Size that still
    // carries stock, in canonical Size order. Never a universal Size table.
    const columnIds = new Set([...activeSizeIds, ...cellRows.map((c) => c.size_id)]);
    const sizes: RetailStoreInventorySizeColumn[] = [...columnIds]
      .map((sizeId) => sizeById.get(sizeId))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map((s) => ({
        sizeId: s.id,
        sizeCode: s.code,
        sizeLabel: s.label,
        sortOrder: s.sortOrder,
        active: activeSizeIds.has(s.id),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.sizeCode.localeCompare(b.sizeCode));

    let total: RawInventoryComponents = EMPTY_COMPONENTS;
    const cells: Record<string, RetailStoreInventoryMeasures> = {};
    for (const row of cellRows) {
      const raw = rawComponentsFromRow(row);
      total = addComponents(total, raw);
      cells[row.size_id] = toMeasures(raw, 'SALE_RETURN');
    }

    const distributors: SaleOrReturnStockDistributorBreakdown[] = distributorRows.map((row) => ({
      distributor: { id: row.distributor_id, code: row.distributor_code, name: row.distributor_name },
      storeCount: Number(row.store_count ?? 0),
      measures: measuresOf(row),
    }));

    return {
      card: {
        cardKey: `${style.id}:SALE_RETURN`,
        styleId: style.id,
        styleNumber: style.styleNumber,
        styleName: style.styleName,
        primaryImage: toPrimaryImageView(style.images ?? []),
        purchaseMode: 'SALE_RETURN',
        sizes,
        cells,
        total: toMeasures(total, 'SALE_RETURN'),
      },
      distributors,
    };
  }, readOptions);
}

// ----- Level 3 (Stores) ------------------------------------------------------

export async function listStockStyleStores(
  actor: CurrentUser,
  styleId: string,
  query: StockStyleScopeQuery,
): Promise<SaleOrReturnStockStoresResponse> {
  const distributorId = resolveScope(actor, query.distributorId);
  const rows = await prisma.$transaction(
    (tx) => tx.$queryRaw<Array<Row & StockStoreRow>>(styleStoresQuery({ distributorId, styleId })),
    readOptions,
  );
  const items: SaleOrReturnStockStoreBreakdown[] = rows.map((row) => ({
    storeKey: row.store_key,
    mapped: row.retail_store_id !== null,
    retailStoreId: row.retail_store_id,
    code: row.store_code,
    name: row.store_name,
    city: row.store_city,
    state: row.store_state,
    status: row.store_status,
    distributor: { id: row.distributor_id, code: row.distributor_code, name: row.distributor_name },
    measures: measuresOf(row),
  }));
  return { items };
}

// ----- Level 4 (Dispatch / Order sources) ------------------------------------

export async function listStockStyleSources(
  actor: CurrentUser,
  styleId: string,
  query: ListStockStyleSourcesQuery,
): Promise<SaleOrReturnStockSourcesResponse> {
  const distributorId = resolveScope(actor, query.distributorId);
  const cursor = query.cursor ? decodeCursor<SourceCursor>(query.cursor, sourceCursorSchema) : null;
  const fetched = await prisma.$transaction(
    (tx) =>
      tx.$queryRaw<Array<SourceRow & { distributor_code: string; distributor_name: string }>>(
        styleSourcesQuery(
          { distributorId, styleId, sizeId: query.sizeId ?? null, storeKey: query.storeKey ?? null },
          cursor,
          query.limit,
        ),
      ),
    readOptions,
  );
  const hasMore = fetched.length > query.limit;
  const rows = hasMore ? fetched.slice(0, query.limit) : fetched;

  const items: SaleOrReturnStockSource[] = rows.map((row) => ({
    ...toInventorySource(row),
    distributor: {
      id: String(row.distributor_id),
      code: row.distributor_code,
      name: row.distributor_name,
    },
    storeKey: String(row.store_key),
  }));
  const last = rows.at(-1);
  return {
    items,
    pageInfo: {
      limit: query.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              dispatchDate: last.dispatch_date.toISOString().slice(0, 10),
              dispatchId: last.dispatch_id,
              saleOrderLineId: last.sol_id,
            } satisfies SourceCursor)
          : null,
    },
  };
}
