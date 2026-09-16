import { formatPdfDate, formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { INVOICE_HANDOFF_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { InvoiceHandoffView } from '../../types.js';

export interface InvoiceHandoffDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface InvoiceHandoffDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  tallyItems: PdfKeyValueItem[];
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded invoice handoff detail record + meta into
 * the plain view-model InvoiceHandoffDetailDocument renders. Field-by-field allowlist, never
 * `...handoff`.
 *
 * This is the "Dispatch Sale" physical-movement Tally reference record ONLY — never labeled Tax
 * Invoice/GST Invoice/Commercial Invoice, and it prints no amount/tax/GST fields, because none
 * exist on this model: Tally computes and owns pricing/tax, this system only stores the resulting
 * reference (see the schema's invoice_handoffs module doc). tallyVoucherReference/remarks/recordedBy
 * are already redacted server-side for a DISTRIBUTOR caller (toInvoiceHandoffView's `full` gate) —
 * this view model only ever sees whatever the API actually returned for the current viewer.
 */
export function buildInvoiceHandoffDetailViewModel(
  handoff: InvoiceHandoffView,
  meta: InvoiceHandoffDetailPdfMeta,
): InvoiceHandoffDetailPdfViewModel {
  const modeLabel = handoff.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return';

  const identityItems: PdfKeyValueItem[] = [
    { label: 'Style / Size', value: `${handoff.style.styleNumber} / ${handoff.size.sizeLabel}` },
    { label: 'Purchase Mode', value: modeLabel },
    { label: 'Erve Dispatch', value: handoff.erveDispatch.erveDispatchNumber },
    { label: 'Dispatch Date', value: formatPdfDate(handoff.erveDispatch.dispatchDate) },
    { label: 'Distributor', value: handoff.distributor.name },
    { label: 'Dispatch Order', value: handoff.saleOrder.saleOrderNumber },
    { label: 'Dispatched (Invoiceable) Quantity', value: handoff.quantity },
    { label: 'Status', value: INVOICE_HANDOFF_STATUS_LABELS[handoff.status] },
  ];

  const tallyItems: PdfKeyValueItem[] = [
    { label: 'Tally Invoice #', value: handoff.tallyInvoiceNumber },
    { label: 'Tally Invoice Date', value: handoff.tallyInvoiceDate ? formatPdfDate(handoff.tallyInvoiceDate) : null },
    { label: 'Tally Voucher Reference', value: handoff.tallyVoucherReference },
    { label: 'Recorded By', value: handoff.recordedBy ? `${handoff.recordedBy.name} · ${formatPdfDateTime(handoff.recordedAt)}` : null },
    { label: 'Remarks', value: handoff.remarks },
  ];

  return {
    title: 'INVOICE HANDOFF',
    subtitle: `${handoff.style.styleNumber} / ${handoff.size.sizeLabel} — ${modeLabel} — ${handoff.distributor.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    tallyItems,
  };
}
