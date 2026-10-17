import type { AuthUser } from '@erve/types';
import { canManageJobOrderProduction, canMutateQualityExecution } from '../../../auth/permissions.js';
import type { JobOrder } from '../types.js';

export type JobOrderActionTarget =
  | { kind: 'tab'; tab: 'production' | 'quality' }
  | { kind: 'form'; path: string };

export interface JobOrderRequiredAction {
  id: string;
  label: string;
  detail: string;
  target: JobOrderActionTarget;
}

/**
 * ISS-005: an index of actions already available in Production / Quality.
 * This function NEVER changes eligibility, starts an execution or mutates state.
 * Ineligible actions are absent (not presented as disabled buttons).
 */
export function getJobOrderRequiredActions(
  jobOrder: JobOrder,
  user: AuthUser | null | undefined,
): JobOrderRequiredAction[] {
  if (jobOrder.historicalImport || jobOrder.status === 'CANCELLED') return [];
  const actions: JobOrderRequiredAction[] = [];

  if (
    canManageJobOrderProduction(user) &&
    ['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'].includes(jobOrder.status)
  ) {
    const gateLocked = jobOrder.qualityActivities.some(
      (activity) => activity.executionMode === 'SEQUENTIAL_GATE' && activity.status !== 'COMPLETED',
    );
    const next = jobOrder.stages.find((stage) => stage.status !== 'COMPLETED');
    if (!gateLocked && next && (next.status === 'NOT_STARTED' || next.status === 'IN_PROGRESS')) {
      const verb = next.status === 'NOT_STARTED' ? 'Start' : 'Complete';
      actions.push({
        id: `stage:${next.id}`,
        label: `${verb} ${next.stageNameSnapshot}`,
        detail: 'Production stage',
        target: { kind: 'tab', tab: 'production' },
      });
    }
  }

  if (canMutateQualityExecution(user)) {
    for (const activity of jobOrder.qualityActivities) {
      // An existing DRAFT can always be continued by its authorized QA editor.
      // This does not assert that a *new* execution can be started.
      if (activity.execution?.status === 'DRAFT') {
        actions.push({
          id: `qa:draft:${activity.execution.id}`,
          label: `Continue ${activity.name}`,
          detail: 'Unfinished inspection',
          target: {
            kind: 'form',
            path: activity.qualityForm.executionScope === 'SIZE'
              ? `/qa/${jobOrder.id}`
              : `/quality-executions/${activity.execution.id}`,
          },
        });
        continue;
      }

      if (!activity.eligible) continue;

      if (!activity.execution && activity.status === 'AVAILABLE') {
        actions.push({
          id: `qa:start:${activity.processFlowVersionStageId}`,
          label: `Start ${activity.name}`,
          detail: 'Inspection available',
          target: { kind: 'tab', tab: 'quality' },
        });
        continue;
      }

      if (activity.status === 'FAILED' &&
        activity.execution?.status === 'FINALIZED' &&
        (activity.qualityForm.executionScope === 'SIZE' ||
          (activity.qualityForm.executionScope === 'JOB_ORDER' &&
            activity.executionMode === 'IN_PROCESS' &&
            activity.executionMultiplicity !== 'BATCHED'))) {
        actions.push({
          id: `qa:retry:${activity.processFlowVersionStageId}`,
          label: `Reinspect ${activity.name}`,
          detail: 'New inspection required',
          target: { kind: 'tab', tab: 'quality' },
        });
        continue;
      }

      // Final batches require positive allocatable prepared quantity. Never
      // suggest a new batch solely because the previous attempt is finalized.
      if (activity.executionMultiplicity === 'BATCHED' &&
        activity.execution?.status === 'FINALIZED' &&
        activity.coverage &&
        !activity.coverage.complete &&
        !activity.coverage.reconciliationConflict &&
        activity.coverage.availableBySize?.some((size) => size.availableQuantity > 0)) {
        actions.push({
          id: `qa:batch:${activity.processFlowVersionStageId}`,
          label: `Start next ${activity.name} batch`,
          detail: 'Prepared quantity available for inspection',
          target: { kind: 'tab', tab: 'quality' },
        });
      }
    }
  }

  return actions;
}
