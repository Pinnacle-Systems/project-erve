import { NOT_RECORDED_LABEL, getRecordedPreparedQuantity } from '@erve/app-components';
import { formatPdfDate } from '../../../lib/pdf/format.js';
import { JOB_ORDER_STATUS_LABELS } from '../job-order-ui.js';
import type { JobOrder, JobOrderStatus } from '../types.js';

export interface JobOrderListPdfFilters {
  search?: string;
  status?: JobOrderStatus | '';
  /** Resolved factory name for the active factory filter (the API filter itself is an id). */
  factoryName?: string;
  /** Resolved compact Financial Year code for the active FY filter (the API filter itself is an id). */
  financialYearLabel?: string;
}

export interface JobOrderListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface JobOrderListPdfRow {
  id: string;
  jobOrderNumber: string;
  styleDisplay: string;
  factoryName: string;
  sourceOrderSheetCount: number;
  requiredDeliveryDate: string;
  orderedQuantityTotal: number;
  /** A recorded number, or "Not recorded" for a historical import (unknown, never 0). */
  preparedQuantityTotal: number | string;
  status: string;
}

export interface JobOrderListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: JobOrderListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-fetched (all-pages) Job Order list + filter/meta
 * state into the plain view-model JobOrderListDocument renders. This is a field-by-field allowlist,
 * never `...jobOrder` — a fixture or future API field the caller wasn't expecting cannot silently
 * reach the printed document. Row order is preserved as returned by the API (its fixed
 * id-descending default order); Job Order has no user-facing sort control today. The "Status"
 * column reproduces the list screen's own computed presentation (operationalState.primaryDisplayState
 * plus a separate Delayed indicator) rather than the raw JobOrderStatus, matching current UI truth —
 * a Job Order has exactly one Style/line by current business rule, so its first line represents it.
 */
export function buildJobOrderListViewModel(
  jobOrders: JobOrder[],
  filters: JobOrderListPdfFilters,
  meta: JobOrderListPdfMeta,
): JobOrderListPdfViewModel {
  const rows: JobOrderListPdfRow[] = jobOrders.map((jobOrder) => {
    const line = jobOrder.lines[0];
    const statusLabel = jobOrder.operationalState.primaryDisplayState.label;
    return {
      id: jobOrder.id,
      jobOrderNumber: jobOrder.jobOrderNumber,
      styleDisplay: line ? `${line.styleNumber} ${line.styleName}` : '',
      factoryName: jobOrder.factory.name,
      sourceOrderSheetCount: jobOrder.sourceOrderSheetCount,
      requiredDeliveryDate: jobOrder.requiredDeliveryDate ? formatPdfDate(jobOrder.requiredDeliveryDate) : '',
      orderedQuantityTotal: jobOrder.orderedQuantityTotal,
      preparedQuantityTotal:
        getRecordedPreparedQuantity(jobOrder, jobOrder.preparedQuantityTotal) ?? NOT_RECORDED_LABEL,
      status: jobOrder.isDelayed ? `${statusLabel} (Delayed)` : statusLabel,
    };
  });

  return {
    title: 'JOB ORDER LIST',
    subtitle: 'Factory production orders created from Order Sheet demand',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Status', value: filters.status ? JOB_ORDER_STATUS_LABELS[filters.status] : '' },
      { label: 'Factory', value: filters.factoryName ?? '' },
      { label: 'Financial Year', value: filters.financialYearLabel ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
