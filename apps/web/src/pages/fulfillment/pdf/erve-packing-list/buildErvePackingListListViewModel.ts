import { formatPdfDate } from '../../../../lib/pdf/format.js';
import { ERVE_PACKING_LIST_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { ErvePackingListSummary } from '../../types.js';

export interface ErvePackingListListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface ErvePackingListListPdfRow {
  id: string;
  ervePackingListNumber: string;
  distributorName: string;
  destinationDisplay: string;
  cartonCount: number;
  totalQuantity: number;
  sourceFactoryCount: number;
  sourceDispatchOrderCount: number;
  statusLabel: string;
  createdAt: string;
}

export interface ErvePackingListListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: ErvePackingListListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages) Erve Packing List summaries
 * into the plain view-model ErvePackingListListDocument renders. Field-by-field allowlist, never
 * `...packingList` — a fixture or future API field the caller wasn't expecting cannot silently
 * reach the printed document. Source Factory/Dispatch Order counts only (never the raw ids), per
 * ErvePackingListSummary — cross-DO/cross-Factory consolidation is shown as a count, matching the
 * on-screen list columns. The screen exposes no filter/sort control, so there is no filter summary.
 */
export function buildErvePackingListListViewModel(
  packingLists: ErvePackingListSummary[],
  meta: ErvePackingListListPdfMeta,
): ErvePackingListListPdfViewModel {
  const rows: ErvePackingListListPdfRow[] = packingLists.map((pl) => ({
    id: pl.id,
    ervePackingListNumber: pl.ervePackingListNumber,
    distributorName: pl.distributor?.name ?? '',
    destinationDisplay: pl.destination.city ? `${pl.destination.city}, ${pl.destination.state ?? ''}` : '',
    cartonCount: pl.cartonCount,
    totalQuantity: pl.totalQuantity,
    sourceFactoryCount: pl.sourceFactories.length,
    sourceDispatchOrderCount: pl.sourceDispatchOrders.length,
    statusLabel: ERVE_PACKING_LIST_STATUS_LABELS[pl.status],
    createdAt: formatPdfDate(pl.createdAt),
  }));

  return {
    title: 'ERVE PACKING LIST',
    subtitle: 'Destination-specific consolidation of finalized Factory Packing cartons',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
