import { formatPdfDate, formatPdfDateTime } from '../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
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

export interface OrderSheetDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface OrderSheetDetailSizeRow {
  id: string;
  sizeCode: string;
  orderedQuantity: number;
}

export interface OrderSheetDetailLineSection {
  id: string;
  styleNumber: string;
  styleName: string;
  seasonDisplay: string;
  totalOrderedQuantity: number;
  sizes: OrderSheetDetailSizeRow[];
}

export interface OrderSheetDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  lines: OrderSheetDetailLineSection[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Order Sheet detail query data + meta into
 * the plain view-model OrderSheetDetailDocument renders. This is a field-by-field allowlist, never
 * `...po` / `...line` — a fixture or future API field the caller wasn't expecting cannot silently
 * reach the printed document. Line/size order is preserved as returned by the API. Locking is
 * represented as "Job Order" / planning state, never as an invented "Approved" status — this
 * business model has no approval workflow.
 */
export function buildOrderSheetDetailViewModel(
  po: PurchaseOrder,
  meta: OrderSheetDetailPdfMeta,
): OrderSheetDetailPdfViewModel {
  const planningState = PLANNING_STATE_LABELS[getOrderSheetPlanningState(po)];

  const identityItems: PdfKeyValueItem[] = [
    { label: 'Order Sheet Number', value: po.poNumber },
    { label: 'Distributor', value: po.distributor.name },
    { label: 'Financial Year', value: po.financialYear.code },
    { label: 'Purchase Mode', value: PURCHASE_MODE_LABELS[po.purchaseMode] },
    { label: 'Order Sheet Date', value: formatPdfDate(po.poDate) },
    {
      label: 'Required Delivery Date',
      value: po.requiredDeliveryDate ? formatPdfDate(po.requiredDeliveryDate) : null,
    },
    { label: 'Total Quantity', value: po.totalOrderedQuantity },
    { label: 'Planning Status', value: planningState },
    {
      label: 'Job Order',
      value: po.lockedByJobOrder ? `${po.lockedByJobOrder.jobOrderNumber} (${po.lockedByJobOrder.status})` : null,
    },
    { label: 'Merchandiser', value: po.merchandiser?.name },
    { label: 'Created By', value: po.creator.name },
    { label: 'Created', value: formatPdfDateTime(po.createdAt) },
    { label: 'Remarks', value: po.remarks },
  ];

  const lines: OrderSheetDetailLineSection[] = po.lines.map((line) => ({
    id: line.id,
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    seasonDisplay: line.seasonSnapshots.map((season) => season.displayName).join(', '),
    totalOrderedQuantity: line.totalOrderedQuantity,
    sizes: line.sizes.map((size) => ({
      id: size.id,
      sizeCode: size.sizeCode,
      orderedQuantity: size.orderedQuantity,
    })),
  }));

  return {
    title: 'ORDER SHEET',
    subtitle: `${po.poNumber} — ${po.distributor.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    lines,
  };
}
