import type { StylePrimaryImageView } from './operations.js';

// A6 / ISS-088 — Retail Store Inventory. A derived, read-only view over
// authoritative records (Erve Dispatch cartons, A4 receipts, the received
// ledger, Sales Reports and Returns). Nothing here is a mutable ledger.

export type RetailStoreInventoryPurchaseMode = 'SALE_RETURN' | 'OUTRIGHT';

/** SALE_RETURN consignment position, from the existing sale-or-return-quantities formulas. */
export interface RetailStoreInventorySaleReturnPosition {
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
  availableForActualSale: number;
  availableForNewReturn: number;
}

/**
 * One set of quantity measures for any grouping level (cell, Style, Store,
 * grand total). `null` always means "no evidence recorded", never zero.
 */
export interface RetailStoreInventoryMeasures {
  /** Number of underlying (Erve Dispatch, Sale Order line) source positions. */
  sourceCount: number;
  /** Physical Erve Dispatch carton quantity (non-retired cartons only). */
  shippedQuantity: number;
  /** Shipped quantity on Dispatches that have no Distributor A4 receipt yet. Not "in transit". */
  awaitingConfirmationQuantity: number;
  /** Shipped quantity on Dispatches that do have a Distributor A4 receipt (the shortage basis). */
  attestedShippedQuantity: number;
  /** Distributor-attested A4 received quantity; null when no source has an A4 receipt. */
  attestedReceivedQuantity: number | null;
  /** Sum of per-source (shipped - attested) where positive; null when no A4 receipt exists. */
  shortageQuantity: number | null;
  /** Received ledger in use (what Sales/Returns key off); null when no source has a ledger row. */
  ledgerQuantity: number | null;
  /** The same ledger split by who recorded it; legacy assumed is an assumption, not evidence. */
  ledgerBySource: {
    distributorConfirmed: number;
    userConfirmed: number;
    legacyAssumedFullReceipt: number;
    /** Ledger rows whose confirmation source was never recorded. */
    unspecified: number;
  };
  /** Sources whose A4 attestation differs from the earlier ledger. Opposite differences never cancel. */
  discrepancySourceCount: number;
  /** SALE_RETURN only. Null for OUTRIGHT: no authoritative store on-hand metric exists. */
  saleReturn: RetailStoreInventorySaleReturnPosition | null;
}

export interface RetailStoreInventorySizeColumn {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sortOrder: number;
  /** False for a Size that is no longer an active Style Size but still carries shipments. */
  active: boolean;
}

/** One Style (at one purchase mode) in one Store, with its own native Size columns. */
export interface RetailStoreInventoryStyleCard {
  /** Stable React key: styleId + purchase mode. */
  cardKey: string;
  styleId: string;
  styleNumber: string;
  styleName: string;
  /** Null when the viewer may not read Style images (e.g. Distributor) or none exists. */
  primaryImage: StylePrimaryImageView | null;
  purchaseMode: RetailStoreInventoryPurchaseMode;
  sizes: RetailStoreInventorySizeColumn[];
  cells: Record<string, RetailStoreInventoryMeasures>;
  total: RetailStoreInventoryMeasures;
}

export interface RetailStoreInventoryStoreIdentity {
  /** `S:<retailStoreId>` for a mapped Store, `D:<saleOrderDestinationId>` for an unmapped historical destination. */
  storeKey: string;
  mapped: boolean;
  retailStoreId: string | null;
  /** Mapped: current Retail Store master values. Unmapped: the original destination's frozen snapshot. */
  code: string | null;
  name: string;
  city: string | null;
  state: string | null;
  /** Master status of a mapped Store; null when unmapped. */
  status: 'ACTIVE' | 'INACTIVE' | null;
}

export interface RetailStoreInventoryStoreGroup extends RetailStoreInventoryStoreIdentity {
  distributor: { id: string; code: string; name: string };
  dispatchCount: number;
  /** Store totals keep the two purchase modes apart: their stock semantics differ. */
  totalsByMode: Partial<Record<RetailStoreInventoryPurchaseMode, RetailStoreInventoryMeasures>>;
  styles: RetailStoreInventoryStyleCard[];
}

export interface RetailStoreInventoryResponse {
  items: RetailStoreInventoryStoreGroup[];
  /** Totals over every matching record, not only this page. */
  summary: {
    storeCount: number;
    dispatchCount: number;
    totalsByMode: Partial<Record<RetailStoreInventoryPurchaseMode, RetailStoreInventoryMeasures>>;
  };
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
}

export type RetailStoreInventoryLedgerSource =
  | 'DISTRIBUTOR_CONFIRMED'
  | 'USER_CONFIRMED'
  | 'LEGACY_ASSUMED_FULL_RECEIPT';

export interface RetailStoreInventoryDestinationSnapshot {
  label: string | null;
  storeCode: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

export interface RetailStoreInventorySource {
  erveDispatchId: string;
  erveDispatchNumber: string;
  dispatchDate: string;
  ervePackingListNumber: string;
  saleOrderId: string;
  saleOrderNumber: string;
  saleOrderLineId: string;
  purchaseMode: RetailStoreInventoryPurchaseMode;
  styleId: string;
  styleNumber: string;
  styleName: string;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  /** Frozen destination snapshot on the Erve Packing List (what the Dispatch document carried). */
  dispatchDestination: RetailStoreInventoryDestinationSnapshot;
  /** The Sale Order destination this line was ordered for, including its own frozen snapshot. */
  orderDestination: RetailStoreInventoryDestinationSnapshot & {
    destinationId: string;
    retailStoreId: string | null;
  };
  shippedQuantity: number;
  receipt: {
    status: 'AWAITING' | 'ATTESTED';
    receivedQuantity: number | null;
    receivedAt: string | null;
    ledgerDisposition: 'APPLIED' | 'NOT_APPLIED_ZERO' | 'EVIDENCE_ONLY_EXISTING' | null;
  };
  ledger: { quantity: number | null; source: RetailStoreInventoryLedgerSource | null };
  shortageQuantity: number | null;
  discrepancy: boolean;
  /** A3 QR proof of delivery for the cartons carrying this line: physical delivery only, never accepted quantity. */
  qr: { cartonCount: number; confirmedCartonCount: number };
  saleReturn: RetailStoreInventorySaleReturnPosition | null;
}

export interface RetailStoreInventorySourcesResponse {
  items: RetailStoreInventorySource[];
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
}
