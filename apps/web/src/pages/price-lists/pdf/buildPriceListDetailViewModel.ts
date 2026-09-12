import { formatPdfDate, formatPdfMoney } from '../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PRICE_LIST_STATUS_LABELS } from '../price-list-ui.js';
import type { PriceList } from '../types.js';

export interface PriceListDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface PriceListDetailLineRow {
  id: string;
  styleNumber: string;
  styleName: string;
  unitPrice: string;
}

export interface PriceListDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  lines: PriceListDetailLineRow[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Price List detail query data + meta into
 * the plain view-model PriceListDetailDocument renders. This is a field-by-field allowlist, never
 * `...priceList` / `...line` — a fixture or future API field the caller wasn't expecting cannot
 * silently reach the printed document. Line order is preserved as returned by the API (style
 * number ascending, per the backend's priceListInclude orderBy).
 */
export function buildPriceListDetailViewModel(
  priceList: PriceList,
  meta: PriceListDetailPdfMeta,
): PriceListDetailPdfViewModel {
  return {
    title: 'PRICE LIST',
    subtitle: `${priceList.code} — ${priceList.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems: [
      { label: 'Price List Code', value: priceList.code },
      { label: 'Name', value: priceList.name },
      { label: 'Distributor', value: priceList.distributor.name },
      { label: 'Status', value: PRICE_LIST_STATUS_LABELS[priceList.status] },
      { label: 'Effective From', value: formatPdfDate(priceList.effectiveFrom) },
      {
        label: 'Effective To',
        value: priceList.effectiveTo ? formatPdfDate(priceList.effectiveTo) : 'Open-ended',
      },
      { label: 'Lines', value: priceList.lineCount },
      { label: 'Created', value: formatPdfDate(priceList.createdAt) },
      { label: 'Last Updated', value: formatPdfDate(priceList.updatedAt) },
    ],
    lines: priceList.lines.map((line) => ({
      id: line.id,
      styleNumber: line.styleNumber,
      styleName: line.styleName,
      unitPrice: formatPdfMoney(line.unitPrice, line.currency),
    })),
  };
}
