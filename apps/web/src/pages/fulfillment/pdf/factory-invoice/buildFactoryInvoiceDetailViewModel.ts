import { formatPdfDateTime, formatPdfMoney } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { FACTORY_INVOICE_STATUS_LABELS } from '../../factory-invoice-ui.js';
import { groupFinancialLinesByStyle } from '../../style-size-grouping.js';
import type { FactoryInvoiceView } from '../../types.js';

export interface FactoryInvoiceDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

/** ISS-010: one row per financially-compatible Style (Style × Size duplication collapsed into a Size Breakdown), not one row per source line — see groupFinancialLinesByStyle. */
export interface FactoryInvoiceDetailLineRow {
  id: string;
  styleDisplay: string;
  sizeBreakdown: string;
  totalQuantity: number;
  rate: string;
  defaultRate: string;
  rateOverridden: boolean;
  amount: string;
}

export interface FactoryInvoiceDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  lines: FactoryInvoiceDetailLineRow[];
  subtotal: string;
  gstAmount: string;
  total: string;
  remarks: string | null;
  /** ISS-025: GST/Total are only settled once the invoice is FINALIZED — pre-finalization they may still be the generation-time default or an in-progress Accountant entry, so the document qualifies them rather than presenting them as a verified statutory calculation. */
  isFinalized: boolean;
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded Factory Invoice detail record + meta into
 * the plain view-model FactoryInvoiceDetailDocument renders. Field-by-field allowlist, never
 * `...invoice`.
 *
 * Every line's quantity is the finalized physical packed quantity snapshot (FactoryInvoiceLine.quantity
 * — never re-derived from the Dispatch Order requested quantity, a FactoryDispatch ledger figure, or
 * planned production). defaultRate/unitRate/lineAmount/subtotal/gstAmount/total are the persisted
 * invoice snapshot (defaultRate an immutable Style<->Factory mapping snapshot taken at generation
 * time, unitRate the current — possibly Accountant-overridden — invoice rate) — never re-resolved
 * from today's StyleFactoryMapping master, so a historical invoice always prints its own saved
 * values. Money uses the app's INR convention (formatPdfMoney — base Helvetica has no ₹ glyph).
 *
 * ISS-010: lines are grouped by financially-compatible Style (groupFinancialLinesByStyle) before
 * formatting — a Style packed across several Sizes prints once with a compact Size Breakdown
 * column, and `amount` is the sum of each source line's own persisted lineAmount, never
 * totalQuantity × rate, so per-line rounding is never silently re-derived.
 */
export function buildFactoryInvoiceDetailViewModel(
  invoice: FactoryInvoiceView,
  meta: FactoryInvoiceDetailPdfMeta,
): FactoryInvoiceDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'Factory', value: invoice.factory.name },
    { label: 'Dispatch Order', value: invoice.saleOrder.saleOrderNumber },
    { label: 'Factory Dispatch #', value: invoice.factoryDispatch.factoryDispatchNumber },
    { label: 'Status', value: FACTORY_INVOICE_STATUS_LABELS[invoice.status] },
    { label: 'Generated', value: formatPdfDateTime(invoice.generatedAt) },
    {
      label: 'Factory Confirmed',
      value: invoice.factoryConfirmedBy ? `${invoice.factoryConfirmedBy.name} · ${formatPdfDateTime(invoice.factoryConfirmedAt)}` : null,
    },
    {
      label: 'Finalized',
      value: invoice.finalizedBy ? `${invoice.finalizedBy.name} · ${formatPdfDateTime(invoice.finalizedAt)}` : null,
    },
  ];

  const lines: FactoryInvoiceDetailLineRow[] = groupFinancialLinesByStyle(invoice.lines).map((group) => ({
    id: group.groupKey,
    styleDisplay: `${group.styleNumber} — ${group.styleName}`,
    sizeBreakdown: group.sizeEntries.map((entry) => `${entry.sizeLabel}: ${entry.quantity}`).join(' · '),
    totalQuantity: group.totalQuantity,
    rate: formatPdfMoney(group.unitRate, 'INR'),
    defaultRate: formatPdfMoney(group.defaultRate, 'INR'),
    rateOverridden: group.rateOverridden,
    amount: formatPdfMoney(group.amount, 'INR'),
  }));

  return {
    title: 'FACTORY INVOICE',
    subtitle: `${invoice.factoryDispatch.factoryDispatchNumber} — ${invoice.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    lines,
    subtotal: formatPdfMoney(invoice.subtotal, 'INR'),
    gstAmount: formatPdfMoney(invoice.gstAmount, 'INR'),
    total: formatPdfMoney(invoice.total, 'INR'),
    remarks: invoice.remarks,
    isFinalized: invoice.status === 'FINALIZED',
  };
}
