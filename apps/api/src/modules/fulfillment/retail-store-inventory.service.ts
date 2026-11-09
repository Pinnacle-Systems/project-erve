import type {
  RetailStoreInventoryMeasures,
  RetailStoreInventoryPurchaseMode,
  RetailStoreInventoryResponse,
  RetailStoreInventorySizeColumn,
  RetailStoreInventorySource,
  RetailStoreInventorySourcesResponse,
  RetailStoreInventoryStoreGroup,
  RetailStoreInventoryStyleCard,
} from '@erve/types';
import { canViewRetailStoreInventory } from '@erve/shared';
import { Prisma, prisma } from '../../db/prisma.js';
import { getSoleDistributorId } from '../../auth/access.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { stylePrimaryImageInclude, toPrimaryImageView } from '../master-data/style-images.service.js';
import {
  cellsQuery,
  distinctCountsQuery,
  sourcesQuery,
  storePageQuery,
  totalsByModeQuery,
  type InventoryScopeFilters,
  type SourceCursor,
  type StoreCursor,
  type StoreRow,
} from './retail-store-inventory-query.js';
import {
  EMPTY_COMPONENTS,
  addComponents,
  rawComponentsFromRow,
  toMeasures,
  type RawInventoryComponents,
} from './retail-store-inventory-measures.js';
import {
  sourceCursorSchema,
  storeCursorSchema,
  type ListRetailStoreInventoryQuery,
  type ListRetailStoreInventorySourcesQuery,
} from './retail-store-inventory.validation.js';

// ---------------------------------------------------------------------------
// A6 / ISS-088 — Retail Store Inventory (read-only, derived).
//
// Source of truth: physical Erve Dispatch carton quantities, the A4 Distributor
// receipt evidence, the received ledger (ErveDispatchDeliveryLine), and the
// Sale-or-Return Sales Report / Return lines — at the existing
// (erveDispatchId, saleOrderLineId) grain. This module owns authorization,
// pagination and response shaping only; the quantity math is SQL aggregation
// (retail-store-inventory-query.ts) plus the shared computeAvailability()
// (retail-store-inventory-measures.ts). There is no inventory table and no
// write path. A7 (ISS-089, FIFO allocation) will build its store-level actions
// on top of the same (Dispatch, Sale Order line) source positions that the
// `/sources` endpoint exposes.
// ---------------------------------------------------------------------------

type Modes = RetailStoreInventoryPurchaseMode;
const readOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 30000,
};

/**
 * Row-level scope. A DISTRIBUTOR (or any user holding that role) is pinned to
 * its single mapped Distributor and cannot ask for another; everyone else who
 * passed the role gate is an internal viewer who may pick a Distributor or
 * leave it open. Checked here as well as at the route so the service is safe
 * to call from anywhere.
 */
function resolveScope(actor: CurrentUser, requestedDistributorId?: string): string | null {
  if (!canViewRetailStoreInventory(actor)) throw HttpError.forbidden();
  if (actor.roles.includes('DISTRIBUTOR')) {
    const own = getSoleDistributorId(actor);
    if (requestedDistributorId && requestedDistributorId !== own) {
      throw HttpError.forbidden('You do not have permission to view data for another distributor');
    }
    return own;
  }
  return requestedDistributorId ?? null;
}

/** Style images are protected media: same audience as the Dispatch detail view and the Style image endpoint. */
function canReadStyleImages(actor: CurrentUser): boolean {
  return actor.roles.some(
    (role) => role === 'ADMIN' || role === 'MERCHANDISER' || role === 'SENIOR_MANAGEMENT',
  );
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

type CellRow = Record<string, string | number | bigint | null> & {
  store_key: string;
  style_id: string;
  size_id: string;
  purchase_mode: Modes;
};

export async function listRetailStoreInventory(
  actor: CurrentUser,
  query: ListRetailStoreInventoryQuery,
): Promise<RetailStoreInventoryResponse> {
  const distributorId = resolveScope(actor, query.distributorId);
  const filters: InventoryScopeFilters = {
    distributorId,
    purchaseMode: query.purchaseMode ?? null,
    storeSearch: query.store ?? null,
    storeKey: query.storeKey ?? null,
    styleSearch: query.style ?? null,
  };
  const cursor = query.cursor ? decodeCursor<StoreCursor>(query.cursor, storeCursorSchema) : null;

  return prisma.$transaction(async (tx) => {
    const fetched = await tx.$queryRaw<StoreRow[]>(storePageQuery(filters, cursor, query.limit));
    const hasMore = fetched.length > query.limit;
    const stores = hasMore ? fetched.slice(0, query.limit) : fetched;

    // Whole-result totals, independent of the page, in the same snapshot.
    const [totalRows, counts] = await Promise.all([
      tx.$queryRaw<Array<Record<string, string | number | bigint | null> & { purchase_mode: Modes }>>(
        totalsByModeQuery(filters),
      ),
      tx.$queryRaw<Array<{ store_count: number; dispatch_count: number }>>(distinctCountsQuery(filters)),
    ]);
    const summaryTotals: RetailStoreInventoryResponse['summary']['totalsByMode'] = {};
    for (const row of totalRows) {
      summaryTotals[row.purchase_mode] = toMeasures(rawComponentsFromRow(row), row.purchase_mode);
    }

    const cellRows = stores.length
      ? await tx.$queryRaw<CellRow[]>(cellsQuery({ ...filters, storeKeys: stores.map((s) => s.store_key) }))
      : [];

    const styleIds = [...new Set(cellRows.map((c) => c.style_id))];
    const sizeIds = [...new Set(cellRows.map((c) => c.size_id))];
    const [styles, styleSizes] = styleIds.length
      ? await Promise.all([
          tx.style.findMany({
            where: { id: { in: styleIds } },
            select: {
              id: true,
              styleNumber: true,
              styleName: true,
              images: { ...stylePrimaryImageInclude, take: canReadStyleImages(actor) ? 1 : 0 },
            },
          }),
          // The Style's own active Size set drives its native columns.
          tx.styleSize.findMany({
            where: { styleId: { in: styleIds }, status: 'ACTIVE', size: { status: 'ACTIVE' } },
            select: { styleId: true, sizeId: true },
          }),
        ])
      : [[], []];
    const sizeMaster = await tx.size.findMany({
      where: { id: { in: [...new Set([...sizeIds, ...styleSizes.map((s) => s.sizeId)])] } },
      select: { id: true, code: true, label: true, sortOrder: true },
    });
    const sizeById = new Map(sizeMaster.map((s) => [s.id, s]));
    const activeSizesByStyle = new Map<string, Set<string>>();
    for (const ss of styleSizes) {
      const set = activeSizesByStyle.get(ss.styleId) ?? new Set<string>();
      set.add(ss.sizeId);
      activeSizesByStyle.set(ss.styleId, set);
    }
    const styleById = new Map(styles.map((s) => [s.id, s]));

    // Group cells -> Store -> Style card (per purchase mode).
    const cellsByStore = new Map<string, CellRow[]>();
    for (const cell of cellRows) {
      const list = cellsByStore.get(cell.store_key) ?? [];
      list.push(cell);
      cellsByStore.set(cell.store_key, list);
    }

    const items: RetailStoreInventoryStoreGroup[] = stores.map((store) => {
      const cards = new Map<string, { styleId: string; mode: Modes; cells: Map<string, RawInventoryComponents> }>();
      for (const cell of cellsByStore.get(store.store_key) ?? []) {
        const key = `${cell.style_id}:${cell.purchase_mode}`;
        let card = cards.get(key);
        if (!card) {
          card = { styleId: cell.style_id, mode: cell.purchase_mode, cells: new Map() };
          cards.set(key, card);
        }
        card.cells.set(cell.size_id, rawComponentsFromRow(cell));
      }

      const modeTotals = new Map<Modes, RawInventoryComponents>();
      const styleCards: RetailStoreInventoryStyleCard[] = [];
      for (const [cardKey, card] of cards) {
        const style = styleById.get(card.styleId);
        if (!style) continue;
        const withShipments = new Set(card.cells.keys());
        const columnIds = new Set([...(activeSizesByStyle.get(card.styleId) ?? []), ...withShipments]);
        const columns: RetailStoreInventorySizeColumn[] = [...columnIds]
          .map((sizeId) => sizeById.get(sizeId))
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
          .map((s) => ({
            sizeId: s.id,
            sizeCode: s.code,
            sizeLabel: s.label,
            sortOrder: s.sortOrder,
            active: activeSizesByStyle.get(card.styleId)?.has(s.id) ?? false,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.sizeCode.localeCompare(b.sizeCode));

        let total = EMPTY_COMPONENTS;
        const measuresBySize: Record<string, RetailStoreInventoryMeasures> = {};
        for (const [sizeId, raw] of card.cells) {
          total = addComponents(total, raw);
          measuresBySize[sizeId] = toMeasures(raw, card.mode);
        }
        modeTotals.set(card.mode, addComponents(modeTotals.get(card.mode) ?? EMPTY_COMPONENTS, total));
        styleCards.push({
          cardKey,
          styleId: style.id,
          styleNumber: style.styleNumber,
          styleName: style.styleName,
          primaryImage: toPrimaryImageView(style.images ?? []),
          purchaseMode: card.mode,
          sizes: columns,
          cells: measuresBySize,
          total: toMeasures(total, card.mode),
        });
      }
      styleCards.sort(
        (a, b) =>
          a.styleNumber.localeCompare(b.styleNumber) ||
          a.purchaseMode.localeCompare(b.purchaseMode),
      );

      const totalsByMode: RetailStoreInventoryStoreGroup['totalsByMode'] = {};
      for (const [mode, raw] of modeTotals) totalsByMode[mode] = toMeasures(raw, mode);

      return {
        storeKey: store.store_key,
        mapped: store.retail_store_id !== null,
        retailStoreId: store.retail_store_id,
        code: store.store_code,
        name: store.store_name,
        city: store.store_city,
        state: store.store_state,
        status: store.store_status,
        distributor: { id: store.distributor_id, code: store.distributor_code, name: store.distributor_name },
        dispatchCount: store.dispatch_count,
        totalsByMode,
        styles: styleCards,
      };
    });

    const last = stores.at(-1);
    return {
      items,
      summary: {
        storeCount: counts[0]?.store_count ?? 0,
        dispatchCount: counts[0]?.dispatch_count ?? 0,
        totalsByMode: summaryTotals,
      },
      pageInfo: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                distributorSort: last.distributor_sort,
                distributorId: last.distributor_id,
                storeSort: last.store_sort,
                storeKey: last.store_key,
              } satisfies StoreCursor)
            : null,
      },
    };
  }, readOptions);
}

type SourceRow = Record<string, string | number | bigint | Date | null> & {
  dispatch_id: string;
  dispatch_number: string;
  dispatch_date: Date;
  sol_id: string;
  purchase_mode: Modes;
  receipt_id: string | null;
  receipt_disposition: 'APPLIED' | 'NOT_APPLIED_ZERO' | 'EVIDENCE_ONLY_EXISTING' | null;
  receipt_received_at: Date | null;
  attestation_line_id: string | null;
  attested_qty: number | null;
  ledger_qty: number | null;
  ledger_source: 'DISTRIBUTOR_CONFIRMED' | 'USER_CONFIRMED' | 'LEGACY_ASSUMED_FULL_RECEIPT' | null;
};

export async function listRetailStoreInventorySources(
  actor: CurrentUser,
  query: ListRetailStoreInventorySourcesQuery,
): Promise<RetailStoreInventorySourcesResponse> {
  const distributorId = resolveScope(actor, query.distributorId);
  const filters: InventoryScopeFilters = {
    distributorId,
    purchaseMode: query.purchaseMode,
    storeKey: query.storeKey,
    styleId: query.styleId,
    sizeId: query.sizeId ?? null,
  };
  const cursor = query.cursor ? decodeCursor<SourceCursor>(query.cursor, sourceCursorSchema) : null;

  const fetched = await prisma.$transaction(
    (tx) => tx.$queryRaw<SourceRow[]>(sourcesQuery(filters, cursor, query.limit)),
    readOptions,
  );
  const hasMore = fetched.length > query.limit;
  const rows = hasMore ? fetched.slice(0, query.limit) : fetched;

  const num = (v: unknown) => Number(v ?? 0);
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const items: RetailStoreInventorySource[] = rows.map((row) => {
    const shipped = num(row.shipped);
    const attested = row.attestation_line_id !== null ? num(row.attested_qty) : null;
    const ledger = row.ledger_qty === null ? null : num(row.ledger_qty);
    const mode = row.purchase_mode;
    const raw: RawInventoryComponents = {
      ...EMPTY_COMPONENTS,
      shipped,
      ledger: ledger ?? 0,
      ledgerCount: ledger === null ? 0 : 1,
      sold: num(row.sold_qty),
      returned: num(row.returned_qty),
      approved: num(row.approved_qty),
      pending: num(row.pending_qty),
    };
    return {
      erveDispatchId: row.dispatch_id,
      erveDispatchNumber: row.dispatch_number,
      dispatchDate: row.dispatch_date.toISOString(),
      ervePackingListNumber: String(row.erve_packing_list_number),
      saleOrderId: String(row.sale_order_id),
      saleOrderNumber: String(row.sale_order_number),
      saleOrderLineId: row.sol_id,
      purchaseMode: mode,
      styleId: String(row.style_id),
      styleNumber: String(row.style_number),
      styleName: String(row.style_name),
      sizeId: String(row.size_id),
      sizeCode: String(row.size_code),
      sizeLabel: String(row.size_label),
      dispatchDestination: {
        label: str(row.pl_label),
        storeCode: str(row.pl_store_code),
        addressLine1: str(row.pl_address1),
        city: str(row.pl_city),
        state: str(row.pl_state),
        postalCode: str(row.pl_postal_code),
      },
      orderDestination: {
        destinationId: String(row.destination_id),
        retailStoreId: str(row.retail_store_id),
        label: str(row.sod_label),
        storeCode: str(row.sod_store_code),
        addressLine1: str(row.sod_address1),
        city: str(row.sod_city),
        state: str(row.sod_state),
        postalCode: str(row.sod_postal_code),
      },
      shippedQuantity: shipped,
      receipt: {
        status: attested === null ? 'AWAITING' : 'ATTESTED',
        receivedQuantity: attested,
        receivedAt: attested === null ? null : (row.receipt_received_at?.toISOString() ?? null),
        ledgerDisposition: attested === null ? null : row.receipt_disposition,
      },
      ledger: { quantity: ledger, source: ledger === null ? null : row.ledger_source },
      shortageQuantity: attested === null ? null : Math.max(0, shipped - attested),
      discrepancy: attested !== null && ledger !== null && attested !== ledger,
      qr: { cartonCount: num(row.carton_count), confirmedCartonCount: num(row.confirmed_count) },
      saleReturn: toMeasures(raw, mode).saleReturn,
    };
  });

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
