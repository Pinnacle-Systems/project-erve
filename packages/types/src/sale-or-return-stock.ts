import type { StylePrimaryImageView } from './operations.js';
import type {
  RetailStoreInventoryMeasures,
  RetailStoreInventoryPurchaseMode,
  RetailStoreInventorySource,
  RetailStoreInventoryStoreIdentity,
  RetailStoreInventoryStyleCard,
} from './retail-store-inventory.js';

// ---------------------------------------------------------------------------
// Sale-or-Return Stock — Style-first consolidated reporting. A derived,
// read-only view: every figure is aggregated in PostgreSQL from the existing
// authoritative (Erve Dispatch, Sale Order line) source positions and finalized
// with the shared computeAvailability(). There is no stock table and no write
// path. Only SALE_RETURN consignment stock is ever included.
//
// Measures reuse RetailStoreInventoryMeasures so every level (Style, Size cell,
// Distributor, Store) means exactly the same thing. `null` there always means
// "no evidence recorded" - never zero.
// ---------------------------------------------------------------------------

export type SaleOrReturnStockPurchaseMode = Extract<RetailStoreInventoryPurchaseMode, 'SALE_RETURN'>;

export interface SaleOrReturnStockDistributorRef {
  id: string;
  code: string;
  name: string;
}

/** Level 1: one row per Style, aggregated across every Dispatch, Distributor and Store in scope. */
export interface SaleOrReturnStockStyleSummary {
  styleId: string;
  styleNumber: string;
  styleName: string;
  /** Null when the viewer may not read Style images or none exists. */
  primaryImage: StylePrimaryImageView | null;
  distributorCount: number;
  storeCount: number;
  measures: RetailStoreInventoryMeasures;
}

export interface SaleOrReturnStockStylesResponse {
  items: SaleOrReturnStockStyleSummary[];
  /** Over every matching Style in scope, not only this page. */
  summary: {
    styleCount: number;
    distributorCount: number;
    storeCount: number;
    measures: RetailStoreInventoryMeasures;
  };
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
}

/** Level 3 (Distributor row): this Style's totals for one Distributor. */
export interface SaleOrReturnStockDistributorBreakdown {
  distributor: SaleOrReturnStockDistributorRef;
  storeCount: number;
  measures: RetailStoreInventoryMeasures;
}

/** Level 2: the Style's consolidated native Size matrix, plus its Distributor-wise totals. */
export interface SaleOrReturnStockStyleDetail {
  /** `cells` per Size and `total` are consolidated over the scope (all Distributors, or the one filtered). */
  card: RetailStoreInventoryStyleCard;
  distributors: SaleOrReturnStockDistributorBreakdown[];
}

/** Level 3 (Store row): one Distributor's Retail Store for this Style. */
export interface SaleOrReturnStockStoreBreakdown extends RetailStoreInventoryStoreIdentity {
  distributor: SaleOrReturnStockDistributorRef;
  measures: RetailStoreInventoryMeasures;
}

export interface SaleOrReturnStockStoresResponse {
  items: SaleOrReturnStockStoreBreakdown[];
}

/** Level 4: one (Erve Dispatch, Sale Order line) source position. Original attribution is never merged. */
export interface SaleOrReturnStockSource extends RetailStoreInventorySource {
  distributor: SaleOrReturnStockDistributorRef;
  storeKey: string;
}

export interface SaleOrReturnStockSourcesResponse {
  items: SaleOrReturnStockSource[];
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
}
