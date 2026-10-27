import { isAxiosError } from 'axios';
import type { ApiErrorResponse, QualityCoverageView } from '@erve/types';
import type { JobOrderLine, JobOrderLineSize } from '../types.js';

export type FlatSize = JobOrderLineSize & {
  style: string;
  linePreparedQuantityTotal: number;
};

export const disclaimerRequiredMessage =
  'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.';

/** Interpret only this action's established API failures; unexpected errors stay private. */
export function sendToFactoryErrorMessage(error: unknown): string {
  const retry = 'Unable to send this Job Order to the factory. Please try again. If the problem continues, reload and review the current Job Order status.';
  if (!isAxiosError(error)) return retry;
  if (!error.response) return 'Unable to contact the server. Check your connection and try again.';
  const { status, data } = error.response;
  if (status >= 500) return retry;
  if (status === 401) return 'Your session has expired. Sign in again before sending this Job Order.';
  if (status === 403) return 'You do not have permission to send this Job Order. Contact your administrator if you need access.';
  if (status === 404) return 'This Job Order could not be found. Return to the Job Order list and refresh it.';
  const body = data && typeof data === 'object' ? data.error : undefined;
  if (!body || typeof body !== 'object') return retry;
  if (body.code === 'DISCLAIMER_REQUIRED') return disclaimerRequiredMessage;
  if (body.code === 'STALE_VERSION' || body.code === 'IDEMPOTENCY_KEY_REUSED')
    return 'This Job Order has changed since it was loaded. Reload it, review the latest details, and try again.';
  if (body.code === 'VALIDATION_ERROR' && Array.isArray(body.details?.issues)) {
    const issues = body.details.issues.flatMap((issue: unknown) => {
      if (!issue || typeof issue !== 'object' || !('message' in issue) || typeof issue.message !== 'string') return [];
      const field = 'field' in issue && typeof issue.field === 'string' ? issue.field : '';
      return [field ? `${field}: ${issue.message}` : issue.message];
    });
    if (issues.length) return issues.join('; ');
  }
  if (typeof body.message !== 'string' || !body.message.trim()) return retry;
  if (body.message === 'Only DRAFT job orders can be sent to factory')
    return 'Only a draft Job Order can be sent to the factory. Reload to review its current status.';
  if (body.message === 'An inactive factory cannot receive a job order')
    return 'This factory is inactive. Ask an administrator to activate it or update the draft Job Order to an active factory before sending.';
  if (body.code === 'VALIDATION_ERROR' || body.code === 'CONFLICT') return body.message;
  return retry;
}

export function mutationErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorResponse>(error)) return error.response?.data.error.message ?? fallback;
  if (error instanceof Error && !error.message.startsWith('Request failed with status code'))
    return error.message;
  return fallback;
}

export function finalBatchStartError(
  error: unknown,
  coverage?: QualityCoverageView | null,
  enteredValues: Record<string, string> = {},
): string {
  const fallback = 'Unable to create the Final batch. Review its size allocation and try again.';
  if (!isAxiosError<ApiErrorResponse>(error)) return fallback;
  const message = error.response?.data.error?.message;
  if (!message) return fallback;

  // A concurrent Final batch can reduce availability after this screen loaded.
  // Use the authoritative remaining count in the server response, never the
  // older amount from the displayed coverage, when explaining this conflict.
  const shortage = /^Final batch allocation for size (\S+) exceeds available prepared quantity (\d+)$/.exec(message);
  if (shortage) {
    const size = coverage?.availableBySize?.find((row) => row.jobOrderLineSizeId === shortage[1]);
    const entered = enteredValues[shortage[1]!];
    if (size && entered !== undefined) {
      return `${size.sizeCode || size.sizeLabel}: You entered ${entered}; only ${shortage[2]} available. Reload to review the latest quantities.`;
    }
    return 'The available quantity changed. Reload this Job Order to review the latest size-wise availability.';
  }
  return message;
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
