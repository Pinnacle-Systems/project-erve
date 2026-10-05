// One-time, idempotent repair for Job Orders left in the inconsistent state
// described in DEMO-013/DEMO-017: `recalculateJobOrderStatus` promoted
// JobOrder.status to PRODUCTION_COMPLETE purely from the quantity + Final QA
// predicate (§ Correction 3), but — before the fix in job-orders.service.ts —
// never stamped productionCompletedAt or reconciled a still-open final
// production stage, which also permanently blocks the manual "Complete
// Stage" action once status leaves CONFIRMED_BY_FACTORY/IN_PRODUCTION. A Job
// Order in this state can never self-heal through the UI.
//
// This does NOT guess from JobOrder.status alone. Every candidate is
// independently re-proven against the exact same canonical predicates
// `recalculateJobOrderStatus` itself uses (ordered vs. prepared quantity,
// every non-cancelled Final QA batch resolved, resolved coverage equal to
// prepared quantity) plus the narrow stage-safety scoping (the final
// production stage is the SOLE stage still open, and it is IN_PROGRESS — not
// some other, unexplained anomaly). A row that doesn't independently
// re-prove every predicate is left alone and reported for manual review
// rather than repaired.
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../db/prisma.js';
import { recordAuditLog } from '../audit/audit.service.js';
import {
  completeStageStatusRow,
  isProcessFlowFinalActivity,
} from '../modules/job-orders/job-orders.service.js';

type CandidateRow = Prisma.JobOrderGetPayload<{
  include: {
    lines: { select: { orderedQuantityTotal: true } };
    processFlowVersion: { include: { stages: { include: { qualityFormVersion: true } } } };
    finalQualityBatches: {
      select: { id: true; processFlowActivityId: true; disposition: true; physicalQuantity: true };
    };
    stageStatuses: {
      select: {
        id: true;
        processFlowVersionStageId: true;
        stageSequence: true;
        stageNameSnapshot: true;
        status: true;
      };
    };
  };
}>;

export type ReconciliationSkipReason =
  | 'NO_FINAL_QA_ACTIVITY'
  | 'PREPARED_QUANTITY_MISMATCH'
  | 'FINAL_QA_NOT_FULLY_RESOLVED'
  | 'FINAL_STAGE_NOT_SOLELY_OPEN';

export interface ReconciliationCandidate {
  jobOrderId: string;
  jobOrderNumber: string;
  orderedQuantityTotal: number;
  preparedQuantityTotal: number;
  resolvedPhysicalCoverage: number;
  finalStageId: string;
  finalStageDefinitionId: string;
  finalStageSequence: number;
  finalStageName: string;
}

export interface ReconciliationSkip {
  jobOrderId: string;
  jobOrderNumber: string;
  reason: ReconciliationSkipReason;
  detail: string;
}

export interface ReconciliationPlan {
  totalInspected: number;
  candidates: ReconciliationCandidate[];
  skipped: ReconciliationSkip[];
}

export async function loadReconciliationCandidateRows(): Promise<CandidateRow[]> {
  return prisma.jobOrder.findMany({
    where: { status: 'PRODUCTION_COMPLETE', productionCompletedAt: null },
    include: {
      lines: { select: { orderedQuantityTotal: true } },
      processFlowVersion: { include: { stages: { include: { qualityFormVersion: true } } } },
      finalQualityBatches: {
        select: { id: true, processFlowActivityId: true, disposition: true, physicalQuantity: true },
      },
      stageStatuses: {
        select: {
          id: true,
          processFlowVersionStageId: true,
          stageSequence: true,
          stageNameSnapshot: true,
          status: true,
        },
        orderBy: { stageSequence: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
}

/** Pure planning step (no I/O) — re-proves every predicate from the rows given. */
export function planCompletionReconciliation(rows: CandidateRow[]): ReconciliationPlan {
  const plan: ReconciliationPlan = { totalInspected: rows.length, candidates: [], skipped: [] };

  for (const jobOrder of rows) {
    const skip = (reason: ReconciliationSkipReason, detail: string) =>
      plan.skipped.push({
        jobOrderId: jobOrder.id,
        jobOrderNumber: jobOrder.jobOrderNumber,
        reason,
        detail,
      });

    const orderedQuantityTotal = jobOrder.lines.reduce((sum, line) => sum + line.orderedQuantityTotal, 0);
    const finalActivity = jobOrder.processFlowVersion.stages.find(isProcessFlowFinalActivity);
    if (!finalActivity) {
      skip('NO_FINAL_QA_ACTIVITY', 'No ACTIVE final-coverage Final QA activity on this process flow version');
      continue;
    }
    if (orderedQuantityTotal <= 0 || jobOrder.preparedQuantityTotal !== orderedQuantityTotal) {
      skip(
        'PREPARED_QUANTITY_MISMATCH',
        `ordered=${orderedQuantityTotal}, prepared=${jobOrder.preparedQuantityTotal}`,
      );
      continue;
    }
    const physicalBatches = jobOrder.finalQualityBatches.filter(
      (batch) => batch.processFlowActivityId === finalActivity.id && batch.disposition !== 'CANCELLED',
    );
    const resolvedPhysicalCoverage = physicalBatches.reduce((sum, batch) => sum + batch.physicalQuantity, 0);
    const fullyResolved =
      physicalBatches.length > 0 &&
      physicalBatches.every((batch) => ['RELEASED', 'PERMANENTLY_REJECTED'].includes(batch.disposition)) &&
      resolvedPhysicalCoverage === jobOrder.preparedQuantityTotal;
    if (!fullyResolved) {
      skip(
        'FINAL_QA_NOT_FULLY_RESOLVED',
        `${physicalBatches.length} batch(es), resolvedCoverage=${resolvedPhysicalCoverage}/${jobOrder.preparedQuantityTotal}`,
      );
      continue;
    }

    const openStages = jobOrder.stageStatuses.filter((stage) => stage.status !== 'COMPLETED');
    const finalStage = jobOrder.stageStatuses.at(-1);
    const stageEligible =
      finalStage !== undefined &&
      openStages.length === 1 &&
      openStages[0]!.id === finalStage.id &&
      openStages[0]!.status === 'IN_PROGRESS';
    if (!stageEligible) {
      skip(
        'FINAL_STAGE_NOT_SOLELY_OPEN',
        `${openStages.length} open stage(s): ${openStages.map((s) => `${s.stageNameSnapshot}=${s.status}`).join(', ') || 'none'}`,
      );
      continue;
    }

    plan.candidates.push({
      jobOrderId: jobOrder.id,
      jobOrderNumber: jobOrder.jobOrderNumber,
      orderedQuantityTotal,
      preparedQuantityTotal: jobOrder.preparedQuantityTotal,
      resolvedPhysicalCoverage,
      finalStageId: finalStage.id,
      finalStageDefinitionId: finalStage.processFlowVersionStageId,
      finalStageSequence: finalStage.stageSequence,
      finalStageName: finalStage.stageNameSnapshot,
    });
  }
  return plan;
}

export function summarizeReconciliationPlan(plan: ReconciliationPlan) {
  const bySkipReason: Record<ReconciliationSkipReason, number> = {
    NO_FINAL_QA_ACTIVITY: 0,
    PREPARED_QUANTITY_MISMATCH: 0,
    FINAL_QA_NOT_FULLY_RESOLVED: 0,
    FINAL_STAGE_NOT_SOLELY_OPEN: 0,
  };
  for (const skip of plan.skipped) bySkipReason[skip.reason]++;
  return {
    totalInspected: plan.totalInspected,
    repairable: plan.candidates.length,
    ...bySkipReason,
  };
}

/**
 * Writes each candidate's repair (productionCompletedAt backfill + final
 * stage completion) in its own transaction, re-verifying the exact same
 * guard conditions against fresh state immediately before writing — a
 * candidate changed by anything since planning is left alone rather than
 * forced.
 */
export async function executeCompletionReconciliation(
  candidates: ReconciliationCandidate[],
  operatorActorId: string,
): Promise<{ repaired: string[]; skippedStale: string[] }> {
  const repaired: string[] = [];
  const skippedStale: string[] = [];

  for (const candidate of candidates) {
    const outcome = await prisma.$transaction(async (tx) => {
      const current = await tx.jobOrder.findUnique({
        where: { id: candidate.jobOrderId },
        select: {
          status: true,
          productionCompletedAt: true,
          stageStatuses: { select: { id: true, status: true } },
        },
      });
      if (!current) return 'stale' as const;
      const finalStageStillOpen = current.stageStatuses.find((s) => s.id === candidate.finalStageId);
      const stillEligible =
        current.status === 'PRODUCTION_COMPLETE' &&
        current.productionCompletedAt === null &&
        current.stageStatuses.every((s) => s.id === candidate.finalStageId || s.status === 'COMPLETED') &&
        finalStageStillOpen?.status === 'IN_PROGRESS';
      if (!stillEligible) return 'stale' as const;

      const now = new Date();
      const updated = await tx.jobOrder.updateMany({
        where: { id: candidate.jobOrderId, status: 'PRODUCTION_COMPLETE', productionCompletedAt: null },
        data: { productionCompletedAt: now },
      });
      if (updated.count !== 1) return 'stale' as const;
      await recordAuditLog(
        {
          actorId: operatorActorId,
          action: 'JOB_ORDER_PRODUCTION_COMPLETION_BACKFILLED',
          entityType: 'JobOrder',
          entityId: candidate.jobOrderId,
          metadata: {
            source: 'job-order-completion-reconciliation-cli',
            orderedQuantityTotal: candidate.orderedQuantityTotal,
            preparedQuantityTotal: candidate.preparedQuantityTotal,
            resolvedPhysicalCoverage: candidate.resolvedPhysicalCoverage,
          },
        },
        tx,
      );
      const stageCompleted = await completeStageStatusRow(
        tx,
        candidate.jobOrderId,
        {
          id: candidate.finalStageId,
          processFlowVersionStageId: candidate.finalStageDefinitionId,
          stageSequence: candidate.finalStageSequence,
          stageNameSnapshot: candidate.finalStageName,
        },
        {
          completedBy: null,
          remarks:
            'Backfilled by the job-order-completion-reconciliation repair utility: Final QA was already fully resolved for the full ordered quantity before this stage was explicitly completed.',
          now,
          auditActorId: operatorActorId,
          auditAction: 'JOB_ORDER_STAGE_COMPLETED_AUTOMATIC',
        },
      );
      return stageCompleted ? ('repaired' as const) : ('stale' as const);
    });
    (outcome === 'repaired' ? repaired : skippedStale).push(candidate.jobOrderId);
  }
  return { repaired, skippedStale };
}
