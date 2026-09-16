import { formatPdfDate } from '../../../../lib/pdf/format.js';
import { INVOICE_HANDOFF_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { InvoiceHandoffListPdfQueryParams } from './prepareInvoiceHandoffListPdfData.js';
import type { InvoiceHandoffView } from '../../types.js';

export interface InvoiceHandoffListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface InvoiceHandoffListPdfRow {
  id: string;
  modeLabel: string;
  erveDispatchNumber: string;
  distributorName: string;
  styleDisplay: string;
  quantity: number;
  statusLabel: string;
  tallyInvoiceNumber: string | null;
  tallyInvoiceDate: string;
}

export interface InvoiceHandoffListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: InvoiceHandoffListPdfRow[];
}

const STATUS_FILTER_LABELS: Record<string, string> = {
  ...INVOICE_HANDOFF_STATUS_LABELS,
  ALL: 'All',
};

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages, single-Status-tab) invoice
 * handoff list into the plain view-model InvoiceHandoffListDocument renders. Field-by-field
 * allowlist, never `...handoff`. This is the physically-dispatched-quantity Tally reference list —
 * never a statutory Tax Invoice/GST Invoice, since Tally computes and owns pricing/tax (see the
 * schema's invoice_handoffs module doc: "No amount/tax/GST fields exist here on purpose").
 */
export function buildInvoiceHandoffListViewModel(
  handoffs: InvoiceHandoffView[],
  queryParams: InvoiceHandoffListPdfQueryParams,
  meta: InvoiceHandoffListPdfMeta,
): InvoiceHandoffListPdfViewModel {
  const rows: InvoiceHandoffListPdfRow[] = handoffs.map((h) => ({
    id: h.id,
    modeLabel: h.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return',
    erveDispatchNumber: h.erveDispatch.erveDispatchNumber,
    distributorName: h.distributor.name,
    styleDisplay: `${h.style.styleNumber} / ${h.size.sizeLabel}`,
    quantity: h.quantity,
    statusLabel: INVOICE_HANDOFF_STATUS_LABELS[h.status],
    tallyInvoiceNumber: h.tallyInvoiceNumber,
    tallyInvoiceDate: h.tallyInvoiceDate ? formatPdfDate(h.tallyInvoiceDate) : '',
  }));

  return {
    title: 'INVOICE HANDOFF LIST',
    subtitle: 'Physically dispatched quantities awaiting a Tally invoice reference',
    filters: [{ label: 'Status', value: queryParams.status ? (STATUS_FILTER_LABELS[queryParams.status] ?? '') : '' }],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
