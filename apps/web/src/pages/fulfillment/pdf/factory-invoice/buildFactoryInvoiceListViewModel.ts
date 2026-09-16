import { formatPdfMoney } from '../../../../lib/pdf/format.js';
import { FACTORY_INVOICE_STATUS_LABELS } from '../../factory-invoice-ui.js';
import type { FactoryInvoiceListPdfQueryParams } from './prepareFactoryInvoiceListPdfData.js';
import type { FactoryInvoiceView } from '../../types.js';

export interface FactoryInvoiceListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryInvoiceListPdfRow {
  id: string;
  factoryName: string;
  saleOrderNumber: string;
  factoryDispatchNumber: string;
  lineCount: number;
  subtotal: string;
  gstAmount: string;
  total: string;
  statusLabel: string;
}

export interface FactoryInvoiceListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: FactoryInvoiceListPdfRow[];
}

const STATUS_FILTER_LABELS: Record<string, string> = {
  ...FACTORY_INVOICE_STATUS_LABELS,
  ALL: 'All',
};

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages, single-Status-tab) Factory
 * Invoice list into the plain view-model FactoryInvoiceListDocument renders. Field-by-field
 * allowlist, never `...invoice` — financial totals use the exact persisted subtotal/gstAmount/total
 * (never re-derived), formatted with the app's INR convention (formatPdfMoney — base Helvetica has
 * no ₹ glyph). The screen's only filter is its Status tab.
 */
export function buildFactoryInvoiceListViewModel(
  invoices: FactoryInvoiceView[],
  queryParams: FactoryInvoiceListPdfQueryParams,
  meta: FactoryInvoiceListPdfMeta,
): FactoryInvoiceListPdfViewModel {
  const rows: FactoryInvoiceListPdfRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    factoryName: invoice.factory.name,
    saleOrderNumber: invoice.saleOrder.saleOrderNumber,
    factoryDispatchNumber: invoice.factoryDispatch.factoryDispatchNumber,
    lineCount: invoice.lines.length,
    subtotal: formatPdfMoney(invoice.subtotal, 'INR'),
    gstAmount: formatPdfMoney(invoice.gstAmount, 'INR'),
    total: formatPdfMoney(invoice.total, 'INR'),
    statusLabel: FACTORY_INVOICE_STATUS_LABELS[invoice.status],
  }));

  return {
    title: 'FACTORY INVOICE LIST',
    subtitle: 'ERVE-generated payable documents snapshotted from finalized Factory Packing Lists',
    filters: [{ label: 'Status', value: queryParams.status ? (STATUS_FILTER_LABELS[queryParams.status] ?? '') : '' }],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
