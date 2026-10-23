import type { JobOrder } from '../types.js';

/** UI projection of existing start/complete-stage rules; API remains authoritative. */
export function getProductionStageEligibility(jobOrder: JobOrder) {
  const nextStage = jobOrder.stages.find((stage) => stage.status !== 'COMPLETED');
  const gateLocked = Boolean(
    nextStage &&
    jobOrder.qualityActivities.some(
      (activity) =>
        activity.executionMode === 'SEQUENTIAL_GATE' &&
        activity.sequence < nextStage.stageSequence &&
        activity.status !== 'COMPLETED' &&
        !activity.executionHistory?.some(
          (execution) =>
            execution.status === 'FINALIZED' &&
            (activity.gateSatisfactionRequirement === 'FINALIZED' || execution.outcome === 'PASS'),
        ),
    ),
  );
  const inlineLocked = Boolean(
    nextStage?.status === 'IN_PROGRESS' &&
    jobOrder.qualityActivities.some(
      (activity) =>
        activity.executionMode === 'IN_PROCESS' &&
        activity.executionMultiplicity === 'SINGLE' &&
        activity.availabilityPolicy === 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE' &&
        activity.associatedProductionActivity?.id === nextStage.processFlowVersionStageId &&
        (activity.execution?.status !== 'FINALIZED' || activity.execution.outcome !== 'PASS'),
    ),
  );
  const canAct =
    !jobOrder.historicalImport &&
    ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status);
  return {
    nextStage,
    gateLocked,
    inlineLocked,
    canStart: canAct && !gateLocked && nextStage?.status === 'NOT_STARTED',
    canComplete: canAct && !gateLocked && !inlineLocked && nextStage?.status === 'IN_PROGRESS',
  };
}
