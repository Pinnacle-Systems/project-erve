import { formatPdfDate } from '../../../lib/pdf/format.js';
import { getOrderSheetPlanningState } from '../types.js';
import type { OrderSheetPlanningState, PurchaseMode, PurchaseOrder } from '../types.js';

// Duplicated from PurchaseOrderListPage.tsx / PurchaseOrderDetailPage.tsx rather than extracted,
// matching this codebase's existing convention of a small per-screen label record.
const PLANNING_STATE_LABELS: Record<OrderSheetPlanningState, string> = {
  AVAILABLE: 'Available for Job Order',
  INCLUDED_IN_JOB_ORDER: 'Included in Job Order',
  CANCELLED: 'Cancelled',
};

const PURCHASE_MODE_LABELS: Record<PurchaseMode, string> = {
  OUTRIGHT: 'Outright',
  SALE_RETURN: 'Sale or Return',
};

export interface OrderSheetListPdfFilters {
  search?: string;
  planningState?: OrderSheetPlanningState | '';
  /** Resolved distributor name for the active distributor filter (the API filter itself is an id). */
  distributorName?: string;
  purchaseMode?: PurchaseMode | '';
  /** Resolved compact Financial Year code for the active FY filter (the API filter itself is an id). */
  financialYearLabel?: string;
}

export interface OrderSheetListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface OrderSheetListPdfRow {
  id: string;
  poNumber: string;
  distributorName: string;
  styleNumber: string;
  styleName: string;
  purchaseMode: string;
  poDate: string;
  requiredDeliveryDate: string;
  totalOrderedQuantity: number;
  planningState: string;
  jobOrderNumber: string;
}

export interface OrderSheetListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: OrderSheetListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages) Order Sheet list + filter/meta
 * state into the plain view-model OrderSheetListDocument renders. This is a field-by-field
 * allowlist, never `...po` — a fixture or future API field the caller wasn't expecting cannot
 * silently reach the printed document. Row order is preserved as returned by the API (its fixed
 * id-descending default order); Order Sheet has no user-facing sort control today. Each Order
 * Sheet is one Style by current business rule, so the first line's Style fields represent the
 * whole row; an Order Sheet with no lines (should not occur) prints an em dash rather than throwing.
 */
export function buildOrderSheetListViewModel(
  orders: PurchaseOrder[],
  filters: OrderSheetListPdfFilters,
  meta: OrderSheetListPdfMeta,
): OrderSheetListPdfViewModel {
  const rows: OrderSheetListPdfRow[] = orders.map((po) => {
    const line = po.lines[0];
    return {
      id: po.id,
      poNumber: po.poNumber,
      distributorName: po.distributor.name,
      styleNumber: line?.styleNumber ?? '',
      styleName: line?.styleName ?? '',
      purchaseMode: PURCHASE_MODE_LABELS[po.purchaseMode],
      poDate: formatPdfDate(po.poDate),
      requiredDeliveryDate: po.requiredDeliveryDate ? formatPdfDate(po.requiredDeliveryDate) : '',
      totalOrderedQuantity: po.totalOrderedQuantity,
      planningState: PLANNING_STATE_LABELS[getOrderSheetPlanningState(po)],
      jobOrderNumber: po.lockedByJobOrder?.jobOrderNumber ?? '',
    };
  });

  return {
    title: 'ORDER SHEET LIST',
    subtitle: 'Distributor demand forecast',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Planning State', value: filters.planningState ? PLANNING_STATE_LABELS[filters.planningState] : '' },
      { label: 'Distributor', value: filters.distributorName ?? '' },
      { label: 'Purchase Mode', value: filters.purchaseMode ? PURCHASE_MODE_LABELS[filters.purchaseMode] : '' },
      { label: 'Financial Year', value: filters.financialYearLabel ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
