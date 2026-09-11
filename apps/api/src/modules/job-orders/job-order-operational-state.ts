import type {
  FactoryConfirmationStatus,
  JobOrderOperationalState,
  JobOrderStage,
  JobOrderStatus,
  JobOrderQualityActivity,
  OperationalStateValue,
} from '@erve/types';

const lifecycleLabels: Record<JobOrderStatus, string> = {
  DRAFT: 'Draft',
  SENT_TO_FACTORY: 'Sent to Factory',
  CONFIRMED_BY_FACTORY: 'Factory Confirmed',
  IN_PRODUCTION: 'In Production',
  PRODUCTION_COMPLETE: 'Production Complete',
  READY_FOR_QA: 'Ready for QA',
  QA_IN_PROGRESS: 'QA in Progress',
  REWORK_REQUIRED: 'Rework Required',
  READY_FOR_REINSPECTION: 'Ready for Reinspection',
  QA_APPROVED: 'QA Approved',
  QA_PASSED: 'QA Passed',
  PARTIALLY_QA_PASSED: 'Partially QA Passed',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

// § Correction 6. Statuses reached strictly before PRODUCTION_COMPLETE — the
// only ones where "production is still open" is meaningful. Every other
// status (PRODUCTION_COMPLETE itself, every post-completion QA state, and
// CLOSED) is reached only after production is done and is never regressed
// to one of these (see job-orders.service.ts's PRODUCTION_COMPLETE
// evaluation and qa.service.ts's rework loop), and CANCELLED is excluded
// separately since it is not an active production obligation at all.
const OPEN_PRODUCTION_STATUSES: readonly JobOrderStatus[] = [
  'DRAFT',
  'SENT_TO_FACTORY',
  'CONFIRMED_BY_FACTORY',
  'IN_PRODUCTION',
];

// Required Delivery Date is a target, not a hard deadline: this is a pure,
// derived read-time indicator (never persisted, never blocks workflow, never
// triggers a lifecycle transition). `businessToday` must be the caller's
// current ERVE business-timezone calendar date (see
// financial-year.util.ts's `toBusinessCalendarDate`) represented the same
// way as `requiredDeliveryDate` — UTC midnight of the calendar day — so the
// comparison is timezone-safe without redoing the conversion here.
export function isJobOrderDelayed(input: {
  status: JobOrderStatus;
  requiredDeliveryDate: Date | null;
  businessToday: Date;
}): boolean {
  if (!input.requiredDeliveryDate) return false;
  if (!OPEN_PRODUCTION_STATUSES.includes(input.status)) return false;
  return input.requiredDeliveryDate.getTime() < input.businessToday.getTime();
}

function value(
  code: string,
  label: string,
  tone: OperationalStateValue['tone'],
  activity?: { processFlowVersionStageId: string; name: string },
): OperationalStateValue {
  return {
    code,
    label,
    tone,
    activityId: activity?.processFlowVersionStageId ?? null,
    activityName: activity?.name ?? null,
  };
}

function lifecycleState(status: JobOrderStatus): OperationalStateValue {
  const tone =
    status === 'CANCELLED'
      ? 'danger'
      : ['CLOSED', 'QA_APPROVED', 'QA_PASSED'].includes(status)
        ? 'success'
        : status === 'DRAFT'
          ? 'muted'
          : 'pending';
  return value(status, lifecycleLabels[status], tone);
}

function deriveQualityState(activities: JobOrderQualityActivity[]): OperationalStateValue | null {
  if (activities.length === 0) return null;

  const conflict = activities.find((activity) => activity.coverage?.state === 'CONFLICT');
  if (conflict) return value('CONFLICT', `${conflict.name} Conflict`, 'danger', conflict);

  const blockingGate = activities.find(
    (activity) => activity.executionMode === 'SEQUENTIAL_GATE' && activity.status !== 'COMPLETED',
  );
  if (blockingGate) return qualityActivityState(blockingGate);

  const currentInProcess = [...activities]
    .reverse()
    .find((activity) => ['AVAILABLE', 'IN_PROGRESS', 'FAILED', 'MISSED'].includes(activity.status));
  if (currentInProcess) return qualityActivityState(currentInProcess);

  const completed = [...activities].reverse().find((activity) => activity.status === 'COMPLETED');
  return completed ? qualityActivityState(completed) : null;
}

function qualityActivityState(activity: JobOrderQualityActivity): OperationalStateValue {
  if (activity.coverage?.state === 'CONFLICT')
    return value('CONFLICT', `${activity.name} Conflict`, 'danger', activity);
  if (activity.status === 'AVAILABLE')
    return value('PENDING', `${activity.name} Pending`, 'pending', activity);
  if (activity.status === 'IN_PROGRESS')
    return value('IN_PROGRESS', `${activity.name} In Progress`, 'info', activity);
  if (activity.status === 'COMPLETED')
    return value('COMPLETED', `${activity.name} Completed`, 'success', activity);
  if (activity.status === 'FAILED')
    return value('FAILED', `${activity.name} Failed`, 'danger', activity);
  if (activity.status === 'MISSED')
    return value('MISSED', `${activity.name} Missed`, 'warning', activity);
  return value('NOT_AVAILABLE', `${activity.name} Not Available`, 'muted', activity);
}

export function deriveJobOrderOperationalState(input: {
  status: JobOrderStatus;
  factoryConfirmationStatus: FactoryConfirmationStatus;
  stages: JobOrderStage[];
  qualityActivities: JobOrderQualityActivity[];
}): JobOrderOperationalState {
  const lifecycleContext = lifecycleState(input.status);
  if (
    ['DRAFT', 'SENT_TO_FACTORY', 'CANCELLED', 'CLOSED'].includes(input.status) ||
    input.factoryConfirmationStatus !== 'CONFIRMED'
  ) {
    return {
      lifecycleContext,
      productionState: null,
      qualityState: null,
      primaryDisplayState: lifecycleContext,
    };
  }

  const qualityState = deriveQualityState(input.qualityActivities);
  const gateLocked = input.qualityActivities.some(
    (activity) => activity.executionMode === 'SEQUENTIAL_GATE' && activity.status !== 'COMPLETED',
  );
  const nextProduction = input.stages.find((stage) => stage.status !== 'COMPLETED');
  const productionState = gateLocked
    ? value('LOCKED', 'Production Locked', 'muted')
    : nextProduction?.status === 'IN_PROGRESS'
      ? value('IN_PROGRESS', `${nextProduction.stageNameSnapshot} In Progress`, 'info', {
          processFlowVersionStageId: nextProduction.processFlowVersionStageId,
          name: nextProduction.stageNameSnapshot,
        })
      : nextProduction
        ? value(
            input.stages.some((stage) => stage.status === 'COMPLETED') ? 'PENDING' : 'READY',
            `${nextProduction.stageNameSnapshot} ${input.stages.some((stage) => stage.status === 'COMPLETED') ? 'Pending' : 'Ready'}`,
            'pending',
            {
              processFlowVersionStageId: nextProduction.processFlowVersionStageId,
              name: nextProduction.stageNameSnapshot,
            },
          )
        : value('COMPLETED', 'Production Completed', 'success');

  let primaryDisplayState: OperationalStateValue;
  if (qualityState?.code === 'CONFLICT') primaryDisplayState = qualityState;
  else if (gateLocked && qualityState) primaryDisplayState = qualityState;
  else if (productionState.code !== 'COMPLETED') primaryDisplayState = productionState;
  else if (qualityState && qualityState.code !== 'COMPLETED') primaryDisplayState = qualityState;
  else primaryDisplayState = value('COMPLETED', 'Workflow Completed', 'success');

  return { lifecycleContext, productionState, qualityState, primaryDisplayState };
}
