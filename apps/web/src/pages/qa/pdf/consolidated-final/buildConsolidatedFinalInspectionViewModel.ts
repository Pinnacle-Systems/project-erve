import type { QualityExecutionView } from '@erve/types';
import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { displayQualityActivityName } from '../shared/displayQualityActivityName.js';
import { buildQualitySections, type QualityPdfSection } from '../shared/qualityResponseBlocks.js';
import type { PreparedConsolidatedFinalInspectionPdfData } from './prepareConsolidatedFinalInspectionPdfData.js';

export interface ConsolidatedFinalInspectionPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
  identityItems?: Array<{ label: string; value: string }>;
}

// Mirrors buildQualityExecutionViewModel's own label maps (ISS-049: kept as a small, independent
// copy rather than an import, so this new report never risks changing the already-shipped single-
// execution PDF's behavior).
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

export interface ConsolidatedFinalInspectionAllocationRow {
  jobOrderLineSizeId: string;
  label: string;
  quantity: number;
}

export interface ConsolidatedFinalInspectionAttemptViewModel {
  id: string;
  attemptNumber: number;
  statusLabel: string;
  /** null for a non-FINALIZED attempt — never a fabricated PASS/FAIL for DRAFT/CANCELLED rows. */
  outcomeLabel: 'PASS' | 'FAIL' | null;
  rejectionReason: string | null;
  remarks: string | null;
  startedByName: string | null;
  startedAt: string;
  finalizedByName: string | null;
  finalizedAt: string | null;
  formVersionNumber: number;
  /** This attempt's own saved checklist/form responses and evidence — never another attempt's. */
  sections: QualityPdfSection[];
}

export interface ConsolidatedFinalInspectionBatchViewModel {
  id: string;
  batchNumber: number;
  isCancelled: boolean;
  physicalQuantity: number;
  dispositionLabel: string;
  allocations: ConsolidatedFinalInspectionAllocationRow[];
  createdAt: string | null;
  createdByName: string | null;
  terminalReason: string | null;
  terminalByName: string | null;
  terminalAt: string | null;
  releasedQuantity: number | null;
  releasedAt: string | null;
  attempts: ConsolidatedFinalInspectionAttemptViewModel[];
}

export interface ConsolidatedFinalInspectionSummaryRow {
  batchNumber: number;
  physicalQuantity: number;
  attemptCount: number;
  latestOutcomeLabel: string;
  dispositionLabel: string;
  releasedQuantity: number | null;
}

export interface ConsolidatedFinalInspectionReconciliation {
  preparedQuantity: number | null;
  activePhysicalQuantity: number | null;
  inspectedPhysicalQuantity: number | null;
  resolvedPhysicalQuantity: number | null;
  releasedQuantity: number | null;
  permanentlyRejectedQuantity: number | null;
  awaitingReinspectionQuantity: number | null;
  remainingQuantity: number | null;
  reconciliationConflict: boolean;
  state: string;
  /** The server's own `finalQaComplete` — never re-derived from the batches this report happens to
   * display, per ISS-049 §6: displaying every currently-finalized attempt is not proof of overall
   * completion. `null` when the server has not reported it. */
  finalQaComplete: boolean | null;
  totalAttemptCount: number;
  activeBatchCount: number;
  totalBatchCount: number;
}

export interface ConsolidatedFinalInspectionPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  headerItems: PdfKeyValueItem[];
  summaryRows: ConsolidatedFinalInspectionSummaryRow[];
  batches: ConsolidatedFinalInspectionBatchViewModel[];
  reconciliation: ConsolidatedFinalInspectionReconciliation;
  image: PdfImageSource;
}

function attemptOutcome(execution: QualityExecutionView): { remarks: string | null } {
  const hasOutcomeComponent = execution.sections.some((section) =>
    section.components.some((component) => component.type === 'INSPECTION_OUTCOME'),
  );
  return { remarks: hasOutcomeComponent ? (execution.responses.outcome?.remarks ?? null) : null };
}

/**
 * Pure, synchronous, no HTTP — maps an already-collected `ConsolidatedFinalInspectionSnapshot` (see
 * `collectConsolidatedFinalInspectionData`) plus pre-resolved evidence images into the printable
 * view model. Every physical-quantity figure here is read once from its authoritative source
 * (`FinalQualityBatchView.physicalQuantity` per batch, `coverage.*` for the overall reconciliation)
 * and never summed across attempts — the exact double-counting the batch/attempt distinction exists
 * to prevent (ISS-049 §7).
 */
export function buildConsolidatedFinalInspectionViewModel(
  prepared: PreparedConsolidatedFinalInspectionPdfData,
  meta: ConsolidatedFinalInspectionPdfMeta,
): ConsolidatedFinalInspectionPdfViewModel {
  const { snapshot, evidenceImages, primaryImage } = prepared;
  const { seedExecution } = snapshot;
  const coverage = seedExecution.coverage;
  const activityDisplayName = displayQualityActivityName(seedExecution.activityName);

  const batches: ConsolidatedFinalInspectionBatchViewModel[] = snapshot.batches.map(({ batch, attempts }) => {
    const attemptSummaryById = new Map(batch.attempts.map((attempt) => [attempt.id, attempt]));
    return {
      id: batch.id,
      batchNumber: batch.batchNumber,
      isCancelled: batch.disposition === 'CANCELLED',
      physicalQuantity: batch.physicalQuantity,
      dispositionLabel: DISPOSITION_LABELS[batch.disposition] ?? batch.disposition,
      allocations: batch.allocations.map((allocation) => ({
        jobOrderLineSizeId: allocation.jobOrderLineSizeId,
        label: `${allocation.sizeCode} · ${allocation.sizeLabel}`,
        quantity: allocation.quantity,
      })),
      createdAt: batch.createdAt ? formatPdfDateTime(batch.createdAt) : null,
      createdByName: batch.createdBy?.name ?? null,
      terminalReason: batch.terminalReason ?? null,
      terminalByName: batch.terminalBy?.name ?? null,
      terminalAt: batch.terminalAt ? formatPdfDateTime(batch.terminalAt) : null,
      releasedQuantity: batch.release?.quantity ?? null,
      releasedAt: batch.release?.releasedAt ? formatPdfDateTime(batch.release.releasedAt) : null,
      attempts: attempts.map((execution) => {
        // Authoritative identity/outcome/rejection-reason summary for this attempt comes from the
        // batch-detail endpoint (the only one that carries startedBy/finalizedBy actor identity);
        // remarks come from this attempt's own full execution record (the batch summary doesn't
        // carry free-text remarks).
        const summary = attemptSummaryById.get(execution.id);
        const isFinalized = (summary?.status ?? execution.status) === 'FINALIZED';
        return {
          id: execution.id,
          attemptNumber: summary?.attemptNumber ?? execution.attemptNumber,
          statusLabel: STATUS_LABELS[summary?.status ?? execution.status] ?? execution.status,
          outcomeLabel: isFinalized ? (summary?.outcome ?? null) : null,
          rejectionReason: isFinalized ? (summary?.rejectionReason ?? null) : null,
          remarks: attemptOutcome(execution).remarks,
          startedByName: summary?.startedBy?.name ?? null,
          startedAt: formatPdfDateTime(summary?.startedAt ?? execution.startedAt),
          finalizedByName: summary?.finalizedBy?.name ?? null,
          finalizedAt: summary?.finalizedAt ? formatPdfDateTime(summary.finalizedAt) : null,
          formVersionNumber: execution.qualityForm.versionNumber,
          sections: buildQualitySections(execution, evidenceImages),
        };
      }),
    };
  });

  const summaryRows: ConsolidatedFinalInspectionSummaryRow[] = batches.map((batch) => {
    const latestFinalized = [...batch.attempts].reverse().find((attempt) => attempt.outcomeLabel !== null);
    return {
      batchNumber: batch.batchNumber,
      physicalQuantity: batch.physicalQuantity,
      attemptCount: batch.attempts.length,
      latestOutcomeLabel: latestFinalized?.outcomeLabel ?? '—',
      dispositionLabel: batch.dispositionLabel,
      releasedQuantity: batch.releasedQuantity,
    };
  });

  const totalAttemptCount = batches.reduce((sum, batch) => sum + batch.attempts.length, 0);
  const activeBatchCount = batches.filter((batch) => !batch.isCancelled).length;

  const reconciliation: ConsolidatedFinalInspectionReconciliation = {
    preparedQuantity: coverage?.preparedQuantityAuthoritative ? (coverage.preparedQuantity ?? null) : null,
    activePhysicalQuantity: coverage?.reservedForFinalQuantity ?? null,
    inspectedPhysicalQuantity: coverage?.inspectedPhysicalCoverage ?? coverage?.physicalFinalCoverage ?? null,
    resolvedPhysicalQuantity: coverage?.resolvedPhysicalCoverage ?? null,
    releasedQuantity: coverage?.releasedQuantity ?? null,
    permanentlyRejectedQuantity: coverage?.permanentlyRejectedQuantity ?? null,
    awaitingReinspectionQuantity: coverage?.awaitingReinspectionQuantity ?? null,
    remainingQuantity: coverage?.remainingQuantity ?? null,
    reconciliationConflict: coverage?.reconciliationConflict ?? false,
    state: coverage?.state ?? 'UNKNOWN',
    finalQaComplete: coverage?.finalQaComplete ?? null,
    totalAttemptCount,
    activeBatchCount,
    totalBatchCount: batches.length,
  };

  const headerItems: PdfKeyValueItem[] = [
    { label: 'Job Order Number', value: seedExecution.jobOrderNumber },
    ...(seedExecution.primaryStyle.consistent
      ? [{ label: 'Style', value: `${seedExecution.primaryStyle.style.styleNumber} - ${seedExecution.primaryStyle.style.styleName}` }]
      : []),
    ...(meta.identityItems ?? []),
    { label: 'QA Activity', value: activityDisplayName },
    { label: 'QA Form', value: seedExecution.qualityForm.name },
    { label: 'Physical Batches (Active)', value: activeBatchCount },
    { label: 'Physical Batches (Incl. Cancelled)', value: batches.length },
  ];

  return {
    title: 'CONSOLIDATED FINAL INSPECTION REPORT',
    subtitle: `${seedExecution.jobOrderNumber} — ${activityDisplayName}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    headerItems,
    summaryRows,
    batches,
    reconciliation,
    image: primaryImage,
  };
}
