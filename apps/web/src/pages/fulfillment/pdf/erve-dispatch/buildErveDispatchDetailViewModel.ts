import { formatPdfDate, formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { ERVE_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { ErveDispatchView } from '../../types.js';

export interface ErveDispatchDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
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
  saleOrReturnLines: ErveDispatchDetailSaleOrReturnRow[];
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded Erve Dispatch detail record + meta into the
 * plain view-model ErveDispatchDetailDocument renders. Field-by-field allowlist, never
 * `...dispatch`.
 *
 * Prints exactly the persisted delivery facts already exposed by the API (status, delivered
 * date/time, received quantities) — never a new POD/delivery workflow, and never a fabricated Tax
 * Invoice section merely because a future architecture expects one invoice per Dispatch.
 *
 * ISS-055: the legacy Invoice/Tally Status section (InvoiceHandoff status, Tally voucher number)
 * is deliberately never printed here — ERVE India must not expose any user-facing Tally reference.
 * The legacy `InvoiceHandoff` model, its backend service, and its own dedicated Invoice Handoff
 * screens are untouched; this removes presentation only, on this document.
 */
export function buildErveDispatchDetailViewModel(
  dispatch: ErveDispatchView,
  meta: ErveDispatchDetailPdfMeta,
): ErveDispatchDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    ...(dispatch.destination ? [
      { label: 'Destination', value: dispatch.destination.label },
      { label: 'Store Code', value: dispatch.destination.storeCode ?? null },
      { label: 'Destination GSTIN', value: dispatch.destination.gstin ?? null },
      { label: 'Destination Address', value: [dispatch.destination.addressLine1, dispatch.destination.addressLine2, dispatch.destination.city, dispatch.destination.state, dispatch.destination.postalCode, dispatch.destination.country].filter(Boolean).join(', ') },
    ] : []),
    { label: 'Erve Dispatch Number', value: dispatch.erveDispatchNumber },
    { label: 'Erve Packing List', value: dispatch.ervePackingList.ervePackingListNumber },
    { label: 'Distributor', value: dispatch.distributor.name },
    // ISS-054: the EISO Dispatch Order number is never printed on this
    // external, distributor-facing PDF — the authorized web detail page
    // (ErveDispatchDetailPage.tsx) still shows it. PDF-only redaction.
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
    saleOrReturnLines,
  };
}
