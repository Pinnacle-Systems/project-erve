import type { FactoryConfirmationStatus, JobOrderStatus, ProductionStageStatus } from './types.js';

export const JOB_ORDER_STATUS_LABELS: Record<JobOrderStatus, string> = {
  DRAFT: 'Draft',
  SENT_TO_FACTORY: 'Sent to Factory',
  CONFIRMED_BY_FACTORY: 'Confirmed',
  IN_PRODUCTION: 'In Production',
  PRODUCTION_COMPLETE: 'Production Complete',
  READY_FOR_QA: 'Ready for QA',
  QA_IN_PROGRESS: 'QA in Progress',
  QA_PASSED: 'QA Passed',
  PARTIALLY_QA_PASSED: 'Partially QA Passed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const CONFIRMATION_LABELS: Record<FactoryConfirmationStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
};

export const STAGE_LABELS: Record<ProductionStageStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusTone(status: JobOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'CLOSED' || status === 'QA_PASSED') return 'success';
  if (status === 'READY_FOR_QA' || status.includes('QA')) return 'info';
  if (status === 'IN_PRODUCTION' || status === 'PRODUCTION_COMPLETE') return 'submitted';
  return 'pending';
}

export function confirmationTone(status: FactoryConfirmationStatus) {
  if (status === 'CONFIRMED') return 'success';
  if (status === 'REJECTED') return 'cancelled';
  return 'pending';
}

export function stageTone(status: ProductionStageStatus) {
  if (status === 'COMPLETED') return 'success';
  if (status === 'IN_PROGRESS') return 'submitted';
  return 'muted';
}
