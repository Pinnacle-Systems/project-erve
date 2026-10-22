import { formatPdfDate } from '../../../../lib/pdf/format.js';
import { ERVE_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { ErveDispatchView } from '../../types.js';

export interface ErveDispatchListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface ErveDispatchListPdfRow {
  id: string;
  erveDispatchNumber: string;
  ervePackingListNumber: string;
  distributorName: string;
  dispatchDate: string;
  statusLabel: string;
  deliveredAt: string;
  transporter: string | null;
  lrNumber: string | null;
  totalQuantity: number;
}

export interface ErveDispatchListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: ErveDispatchListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages) Erve Dispatch list into the
 * plain view-model ErveDispatchListDocument renders. Field-by-field allowlist, never `...dispatch`
 * — saleOrReturnLines (present on the same ErveDispatchView row) is deliberately excluded from the
 * list row: it is printed by the Detail PDF instead. invoiceHandoffs is excluded from both PDFs
 * entirely (ISS-055 — no user-facing Tally references). The screen exposes no filter/sort control,
 * so there is no filter summary.
 */
export function buildErveDispatchListViewModel(
  dispatches: ErveDispatchView[],
  meta: ErveDispatchListPdfMeta,
): ErveDispatchListPdfViewModel {
  const rows: ErveDispatchListPdfRow[] = dispatches.map((d) => ({
    id: d.id,
    erveDispatchNumber: d.erveDispatchNumber,
    ervePackingListNumber: d.ervePackingList.ervePackingListNumber,
    distributorName: d.distributor.name,
    // ISS-054: the EISO Dispatch Order number is never printed on this
    // external, distributor-facing PDF.
    dispatchDate: formatPdfDate(d.dispatchDate),
    statusLabel: ERVE_DISPATCH_STATUS_LABELS[d.status],
    deliveredAt: d.deliveredAt ? formatPdfDate(d.deliveredAt) : '',
    transporter: d.transporter,
    lrNumber: d.lrNumber,
    totalQuantity: d.totalQuantity,
  }));

  return {
    title: 'ERVE DISPATCH LIST',
    subtitle: 'Physical goods movement from Erve India to Distributors',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
