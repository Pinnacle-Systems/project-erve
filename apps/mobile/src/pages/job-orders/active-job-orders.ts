import { isHistoricalImportJobOrder } from '@erve/app-components';
import type { JobOrderDetail } from '@erve/types';

// "Active job orders" (mobile list and home tile) is operational monitoring of
// live work — see docs/MOBILE_OPERATIONAL_SCOPE.md — not the general Job Order
// list. Historical imports are read-only evidence, never active work, so they
// are excluded server-side (the API returns newest first, and the historical
// imports would otherwise fill the fetched page) and again here as a guard.
// Existing live Job Order active-status semantics are unchanged by this fix;
// only the historical-import exclusion is added.

export const ACTIVE_JOB_ORDER_QUERY_PARAMS = { recordOrigin: 'LIVE_WORKFLOW' } as const;

const INACTIVE_STATUSES: ReadonlyArray<JobOrderDetail['status']> = ['DRAFT', 'CLOSED', 'CANCELLED'];

export function isActiveOperationalJobOrder(job: JobOrderDetail): boolean {
  return !INACTIVE_STATUSES.includes(job.status) && !isHistoricalImportJobOrder(job);
}
