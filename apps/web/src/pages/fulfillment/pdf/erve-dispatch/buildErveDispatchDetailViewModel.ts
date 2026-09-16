import { formatPdfDate, formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { ERVE_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { ErveDispatchView } from '../../types.js';

export interface ErveDispatchDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface ErveDispatchDetailInvoiceHandoffRow {
  invoiceHandoffId: string;
  modeLabel: string;
  styleDisplay: string;
  quantity: number;
  statusLabel: string;
  tallyInvoiceNumber: string | null;
}

export interface ErveDispatchDetailSaleOrReturnRow {
  saleOrderLineId: string;
  styleDisplay: string;
  dispatchedQuantity: number;
  receivedQuantity: number;
  actualSoldQuantity: number;
  returnedQuantity: number;
  approvedAwaitingReceiptQuantity: number;
  pendingRequestedQuantity: number;
  remainingWithDistributor: number;
}

export interface ErveDispatchDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  deliveryItems: PdfKeyValueItem[];
  /** `null` when the current viewer's own permission check excludes the Invoice/Tally Status section on-screen. */
  invoiceHandoffs: ErveDispatchDetailInvoiceHandoffRow[] | null;
  saleOrReturnLines: ErveDispatchDetailSaleOrReturnRow[];
}

/** Linked data the viewer's own role may or may not be permitted to see — pass `null` (not `[]`) when the current viewer's permission check excludes the section entirely, mirroring the Dispatch Order Detail PDF pattern. */
export interface ErveDispatchDetailPdfRelated {
  invoiceHandoffs: ErveDispatchView['invoiceHandoffs'] | null;
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded Erve Dispatch detail record + its
 * permission-gated Invoice/Tally section + meta into the plain view-model
 * ErveDispatchDetailDocument renders. Field-by-field allowlist, never `...dispatch`.
 *
 * Prints exactly the persisted delivery facts already exposed by the API (status, delivered
 * date/time, received quantities) — never a new POD/delivery workflow, and never a fabricated Tax
 * Invoice section merely because a future architecture expects one invoice per Dispatch.
 */
export function buildErveDispatchDetailViewModel(
  dispatch: ErveDispatchView,
  related: ErveDispatchDetailPdfRelated,
  meta: ErveDispatchDetailPdfMeta,
): ErveDispatchDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'Erve Dispatch Number', value: dispatch.erveDispatchNumber },
    { label: 'Erve Packing List', value: dispatch.ervePackingList.ervePackingListNumber },
    { label: 'Distributor', value: dispatch.distributor.name },
    { label: 'Dispatch Order', value: dispatch.saleOrder?.saleOrderNumber ?? 'Multiple Dispatch Orders' },
    { label: 'Status', value: ERVE_DISPATCH_STATUS_LABELS[dispatch.status] },
    { label: 'Dispatch Date', value: formatPdfDate(dispatch.dispatchDate) },
    { label: 'Total Quantity', value: dispatch.totalQuantity },
    { label: 'Dispatched By', value: dispatch.dispatchedBy.name },
    { label: 'Dispatched At', value: formatPdfDateTime(dispatch.dispatchedAt) },
    { label: 'Transporter', value: dispatch.transporter },
    { label: 'Vehicle Number', value: dispatch.vehicleNumber },
    { label: 'LR Number', value: dispatch.lrNumber },
    { label: 'Remarks', value: dispatch.remarks },
    {
      label: 'LR Last Updated',
      value: dispatch.lrUpdatedAt ? `${dispatch.lrUpdatedBy?.name ?? ''} · ${formatPdfDateTime(dispatch.lrUpdatedAt)}` : null,
    },
  ];

  const deliveryItems: PdfKeyValueItem[] = [
    {
      label: 'Delivery',
      value:
        dispatch.status !== 'DELIVERED'
          ? 'Not yet confirmed'
          : dispatch.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT'
            ? 'Assumed full receipt (legacy — not actually confirmed)'
            : `${dispatch.deliveredBy?.name ?? ''} · ${dispatch.deliveredAt ? formatPdfDateTime(dispatch.deliveredAt) : ''}`,
    },
    { label: 'Delivery Remarks', value: dispatch.deliveryRemarks },
  ];

  const invoiceHandoffs: ErveDispatchDetailInvoiceHandoffRow[] | null = related.invoiceHandoffs
    ? related.invoiceHandoffs.map((h) => ({
        invoiceHandoffId: h.invoiceHandoffId,
        modeLabel: h.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return',
        styleDisplay: `${h.styleNumber} / ${h.sizeLabel}`,
        quantity: h.quantity,
        statusLabel: h.status === 'PENDING_TALLY' ? 'Pending Tally' : 'Invoiced',
        tallyInvoiceNumber: h.tallyInvoiceNumber,
      }))
    : null;

  const saleOrReturnLines: ErveDispatchDetailSaleOrReturnRow[] = dispatch.saleOrReturnLines.map((line) => ({
    saleOrderLineId: line.saleOrderLineId,
    styleDisplay: `${line.styleNumber} / ${line.sizeLabel}`,
    dispatchedQuantity: line.dispatchedQuantity,
    receivedQuantity: line.receivedQuantity,
    actualSoldQuantity: line.actualSoldQuantity,
    returnedQuantity: line.returnedQuantity,
    approvedAwaitingReceiptQuantity: line.approvedAwaitingReceiptQuantity,
    pendingRequestedQuantity: line.pendingRequestedQuantity,
    remainingWithDistributor: line.remainingWithDistributor,
  }));

  return {
    title: 'ERVE DISPATCH',
    subtitle: `${dispatch.erveDispatchNumber} — ${dispatch.distributor.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    deliveryItems,
    invoiceHandoffs,
    saleOrReturnLines,
  };
}
