import { formatPdfDate } from '../../../lib/pdf/format.js';
import { PRICE_LIST_STATUS_LABELS } from '../price-list-ui.js';
import type { PriceListStatus, PriceListSummary } from '../types.js';

export interface PriceListListPdfFilters {
  search?: string;
  status?: PriceListStatus | '';
  distributorName?: string;
}

export interface PriceListListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface PriceListListPdfRow {
  id: string;
  code: string;
  name: string;
  distributorName: string;
  effectiveFrom: string;
  effectiveTo: string;
  lineCount: number;
  status: string;
}

export interface PriceListListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: PriceListListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-loaded list query data + filter/meta state into
 * the plain view-model PriceListListDocument renders. This is a field-by-field allowlist, never
 * `...priceList` — a fixture or future API field the caller wasn't expecting cannot silently
 * reach the printed document. Row order is preserved as returned by the API (its fixed
 * createdAt-desc order); Price List has no user-facing sort control today.
 */
export function buildPriceListListViewModel(
  priceLists: PriceListSummary[],
  filters: PriceListListPdfFilters,
  meta: PriceListListPdfMeta,
): PriceListListPdfViewModel {
  const rows: PriceListListPdfRow[] = priceLists.map((priceList) => ({
    id: priceList.id,
    code: priceList.code,
    name: priceList.name,
    distributorName: priceList.distributor.name,
    effectiveFrom: formatPdfDate(priceList.effectiveFrom),
    effectiveTo: priceList.effectiveTo ? formatPdfDate(priceList.effectiveTo) : 'Open-ended',
    lineCount: priceList.lineCount,
    status: PRICE_LIST_STATUS_LABELS[priceList.status],
  }));

  return {
    title: 'PRICE LIST MASTER LIST',
    subtitle: 'Distributor-specific selling prices with effective periods',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Status', value: filters.status ? PRICE_LIST_STATUS_LABELS[filters.status] : '' },
      { label: 'Distributor', value: filters.distributorName ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
