import type { QualityExecutionView } from '@erve/types';
import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { displayQualityActivityName } from '../shared/displayQualityActivityName.js';
import { buildQualitySections, type QualityPdfSection } from '../shared/qualityResponseBlocks.js';
import type { PreparedQualityExecutionPdfData } from './prepareQualityExecutionPdfData.js';

export interface QualityExecutionPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

const STATUS_LABELS: Record<QualityExecutionView['status'], string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  CANCELLED: 'Cancelled',
};

const DISPOSITION_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  AWAITING_REINSPECTION: 'Awaiting Reinspection',
  RELEASED: 'Released',
  PERMANENTLY_REJECTED: 'Permanently Rejected',
  CANCELLED: 'Cancelled',
};

const ATTEMPT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Finalized',
  CANCELLED: 'Cancelled',
};

export interface QualityExecutionOutcomeViewModel {
  value: 'PASS' | 'FAIL' | null;
  remarks: string | null;
  rejectionReason: string | null;
}

export interface QualityFinalBatchAllocationRow {
  jobOrderLineSizeId: string;
  label: string;
  quantity: number;
}

export interface QualityFinalBatchAttemptRow {
  id: string;
  attemptNumber: number;
  statusLabel: string;
  outcome: 'PASS' | 'FAIL' | null;
  rejectionReason: string | null;
  startedAt: string;
  finalizedAt: string | null;
}

export interface QualityFinalBatchViewModel {
  batchNumber: number;
  physicalQuantity: number;
  dispositionLabel: string;
  allocations: QualityFinalBatchAllocationRow[];
  attempts: QualityFinalBatchAttemptRow[];
  releasedQuantity: number | null;
  releasedAt: string | null;
}

export interface QualityExecutionPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  headerItems: PdfKeyValueItem[];
  outcome: QualityExecutionOutcomeViewModel | null;
  finalBatch: QualityFinalBatchViewModel | null;
  sections: QualityPdfSection[];
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded `QualityExecutionView` (PPM/Inline/Final all
 * share this exact persisted model and this exact screen, `/quality-executions/:executionId`) plus
 * pre-resolved evidence images into the printable view model.
 *
 * Outcome and Final-batch/disposition are derived structurally, never by activity name: `outcome`
 * is populated only when the execution's own form actually contains an `INSPECTION_OUTCOME`
 * component (PPM's canonical form never does, so PPM prints no PASS/FAIL — this generalizes
 * correctly even if a future form definition changes). `finalBatch` is populated only when
 * `execution.finalBatch` is present (Final Inspection only). STATUS, OUTCOME, and DISPOSITION are
 * kept as three distinct labeled fields, never merged into one.
 */
export function buildQualityExecutionViewModel(
  prepared: PreparedQualityExecutionPdfData,
  meta: QualityExecutionPdfMeta,
): QualityExecutionPdfViewModel {
  const { execution, evidenceImages } = prepared;
  const activityDisplayName = displayQualityActivityName(execution.activityName);

  const hasOutcomeComponent = execution.sections.some((section) =>
    section.components.some((component) => component.type === 'INSPECTION_OUTCOME'),
  );
  const outcome: QualityExecutionOutcomeViewModel | null = hasOutcomeComponent
    ? {
        value: execution.responses.outcome?.value ?? null,
        remarks: execution.responses.outcome?.remarks ?? null,
        rejectionReason:
          execution.finalBatch && execution.responses.outcome?.value === 'FAIL'
            ? (execution.responses.outcome?.rejectionReason ?? null)
            : null,
      }
    : null;

  const finalBatch: QualityFinalBatchViewModel | null = execution.finalBatch
    ? {
        batchNumber: execution.finalBatch.batchNumber,
        physicalQuantity: execution.finalBatch.physicalQuantity,
        dispositionLabel: DISPOSITION_LABELS[execution.finalBatch.disposition] ?? execution.finalBatch.disposition,
        allocations: execution.finalBatch.allocations.map((allocation) => ({
          jobOrderLineSizeId: allocation.jobOrderLineSizeId,
          label: `${allocation.sizeCode} · ${allocation.sizeLabel}`,
          quantity: allocation.quantity,
        })),
        attempts: execution.finalBatch.attempts.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          statusLabel: ATTEMPT_STATUS_LABELS[attempt.status] ?? attempt.status,
          outcome: attempt.outcome,
          rejectionReason: attempt.status === 'FINALIZED' && attempt.outcome === 'FAIL' ? attempt.rejectionReason : null,
          startedAt: formatPdfDateTime(attempt.startedAt),
          finalizedAt: attempt.finalizedAt ? formatPdfDateTime(attempt.finalizedAt) : null,
        })),
        releasedQuantity: execution.finalBatch.release?.quantity ?? null,
        releasedAt: execution.finalBatch.release?.releasedAt
          ? formatPdfDateTime(execution.finalBatch.release.releasedAt)
          : null,
      }
    : null;

  const headerItems: PdfKeyValueItem[] = [
    { label: 'Job Order Number', value: execution.jobOrderNumber },
    { label: 'QA Activity', value: activityDisplayName },
    { label: 'QA Form', value: execution.qualityForm.name },
    { label: 'Form Version', value: execution.qualityForm.versionNumber },
    { label: 'Attempt Number', value: execution.attemptNumber },
    { label: 'Status', value: STATUS_LABELS[execution.status] ?? execution.status },
    { label: 'Started At', value: formatPdfDateTime(execution.startedAt) },
    { label: 'Finalized At', value: execution.finalizedAt ? formatPdfDateTime(execution.finalizedAt) : null },
  ];

  return {
    title: `QA ${activityDisplayName.toUpperCase()}`,
    subtitle: `${execution.jobOrderNumber} — Attempt ${execution.attemptNumber}${
      execution.finalBatch ? ` — Batch ${execution.finalBatch.batchNumber}` : ''
    }`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    headerItems,
    outcome,
    finalBatch,
    sections: buildQualitySections(execution, evidenceImages),
  };
}
