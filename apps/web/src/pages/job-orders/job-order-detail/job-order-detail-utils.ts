import { isAxiosError } from 'axios';
import type { ApiErrorResponse } from '@erve/types';
import type { JobOrderLine, JobOrderLineSize } from '../types.js';

export type FlatSize = JobOrderLineSize & {
  style: string;
  linePreparedQuantityTotal: number;
};

export const disclaimerRequiredMessage =
  'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.';

export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorResponse>(error)) return error.response?.data.error.message ?? fallback;
  if (error instanceof Error && !error.message.startsWith('Request failed with status code'))
    return error.message;
  return fallback;
}

export function finalBatchStartError(error: unknown): string {
  if (!isAxiosError<ApiErrorResponse>(error))
    return 'Unable to create the Final batch. Review its size allocation and try again.';
  const response = error.response?.data.error;
  return response?.message ?? 'Unable to create the Final batch. Review its size allocation.';
}

// A Job Order's source Order Sheets (and the Job Order itself) are required
// to share exactly one Style — enforced server-side in
// apps/api/.../job-orders.service.ts (see the "must share one Style"
// validation on create and on adding a source). `lines` therefore normally
// has one distinct styleId even when it has multiple entries (one per
// consolidated source Order Sheet). This still reads the actual data rather
// than assuming index 0 is authoritative, so a future data anomaly shows an
// accurate count instead of silently picking the first line.
export interface JobOrderStyleSummary {
  label: string;
  multiple: boolean;
}

export function getJobOrderStyleSummary(lines: JobOrderLine[]): JobOrderStyleSummary {
  const distinctStyleIds = new Set(lines.map((line) => line.styleId));
  if (distinctStyleIds.size > 1) {
    return { label: `${distinctStyleIds.size} Styles`, multiple: true };
  }
  const line = lines[0];
  return { label: line ? `${line.styleNumber} ${line.styleName}` : 'No style', multiple: false };
}
