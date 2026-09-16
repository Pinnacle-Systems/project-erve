import type { PurchaseMode } from '@erve/types';
import { formatPdfDate } from '../../../../lib/pdf/format.js';
import { toCompactFinancialYearCode } from '../../../../lib/financial-years.js';
import type { SaleOrder } from '../../../sale-orders/types.js';

export interface DispatchOrderListPdfFilters {
  search?: string;
  /** Resolved distributor name for the active distributor filter (the API filter itself is an id). */
  distributorName?: string;
  /** Resolved factory name for the active factory filter (the API filter itself is an id). */
  factoryName?: string;
}

export interface DispatchOrderListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface DispatchOrderListPdfRow {
  id: string;
  saleOrderNumber: string;
  distributorsDisplay: string;
  factoryName: string;
  soDate: string;
  financialYearCode: string;
  destinationCount: number;
  totalQuantity: number;
  stateLabel: string;
}

export interface DispatchOrderListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: DispatchOrderListPdfRow[];
}

const PURCHASE_MODE_LABELS: Record<PurchaseMode, string> = {
  OUTRIGHT: 'Outright',
  SALE_RETURN: 'Sale/Return',
};

/**
 * A Dispatch Order's Distributor list, mirroring the on-screen 2-name-then-"+N" truncation
 * (SaleOrderListPage.tsx) for the common single-mode case — but when a Dispatch Order mixes
 * OUTRIGHT and SALE_RETURN Distributor groups, that truncated plain-name list would silently
 * flatten the mix away, so every Distributor is shown individually with its own Purchase Mode
 * suffix instead (e.g. "Acme (Outright), Beta (Sale/Return)").
 */
function buildDistributorsDisplay(distributors: SaleOrder['distributors']): string {
  if (distributors.length === 0) return '';
  const distinctModes = new Set(distributors.map((d) => d.purchaseMode));
  if (distinctModes.size <= 1) {
    const names = distributors.map((d) => d.name);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }
  return distributors.map((d) => `${d.name} (${PURCHASE_MODE_LABELS[d.purchaseMode]})`).join(', ');
}

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages) Dispatch Order list + filter/meta
 * state into the plain view-model DispatchOrderListDocument renders. Field-by-field allowlist, never
 * `...saleOrder` — a fixture or future API field the caller wasn't expecting cannot silently reach
 * the printed document. Row order is preserved as returned by the API (its fixed id-descending
 * default order); Dispatch Order has no user-facing sort control today.
 */
export function buildDispatchOrderListViewModel(
  saleOrders: SaleOrder[],
  filters: DispatchOrderListPdfFilters,
  meta: DispatchOrderListPdfMeta,
): DispatchOrderListPdfViewModel {
  const rows: DispatchOrderListPdfRow[] = saleOrders.map((so) => ({
    id: so.id,
    saleOrderNumber: so.saleOrderNumber,
    distributorsDisplay: buildDistributorsDisplay(so.distributors),
    factoryName: so.factory.name,
    soDate: formatPdfDate(so.soDate),
    financialYearCode: toCompactFinancialYearCode(so.financialYear.code),
    destinationCount: so.destinationCount,
    totalQuantity: so.totalQuantity,
    stateLabel: so.isLocked ? 'Factory Dispatched' : 'Ready for Factory',
  }));

  return {
    title: 'DISPATCH ORDER LIST',
    subtitle: 'Pooled Factory stock allocated to Distributor destinations',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Distributor', value: filters.distributorName ?? '' },
      { label: 'Factory', value: filters.factoryName ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
