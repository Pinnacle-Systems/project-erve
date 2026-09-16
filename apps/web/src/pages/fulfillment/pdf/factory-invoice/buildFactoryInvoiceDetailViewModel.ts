import { formatPdfDateTime, formatPdfMoney } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { FACTORY_INVOICE_STATUS_LABELS } from '../../factory-invoice-ui.js';
import type { FactoryInvoiceView } from '../../types.js';

export interface FactoryInvoiceDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryInvoiceDetailLineRow {
  id: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
  defaultRate: string;
  unitRate: string;
  rateOverridden: boolean;
  lineAmount: string;
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

  const lines: FactoryInvoiceDetailLineRow[] = invoice.lines.map((line) => ({
    id: line.id,
    styleDisplay: `${line.styleNumber} — ${line.styleName}`,
    sizeLabel: line.sizeLabel,
    quantity: line.quantity,
    defaultRate: formatPdfMoney(line.defaultRate, 'INR'),
    unitRate: formatPdfMoney(line.unitRate, 'INR'),
    rateOverridden: line.unitRate !== line.defaultRate,
    lineAmount: formatPdfMoney(line.lineAmount, 'INR'),
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
  };
}
