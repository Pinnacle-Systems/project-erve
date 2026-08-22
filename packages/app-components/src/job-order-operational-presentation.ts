import type {
  JobOrderOperationalState,
  OperationalStateValue,
  OperationalStateTone,
} from '@erve/types';

export interface OperationalPresentationLane {
  domain: 'PRODUCTION' | 'QUALITY';
  heading: 'Production' | 'Quality';
  name: string;
  stateLabel: string | null;
  tone: OperationalStateTone;
}

export interface JobOrderOperationalPresentation {
  heading: 'Current Activity' | 'Current State';
  name: string;
  stateLabel: string | null;
  tone: OperationalStateTone;
  secondaryLanes: OperationalPresentationLane[];
}

export interface QaWorkPresentation {
  label: string;
  tone: OperationalStateTone;
}

export interface QaStatusPresentation {
  primary: QaWorkPresentation;
  secondaryLabel: string | null;
}

const stateLabels: Record<string, string> = {
  PENDING: 'Pending',
  READY: 'Ready',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  MISSED: 'Missed',
  CONFLICT: 'Conflict',
  LOCKED: 'Locked',
  NOT_AVAILABLE: 'Not Available',
};

export function displayActivityName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.replace(/[A-Z]+/g, (word) => {
    const acronymLike = word.length > 1 && !/[AEIOU]/.test(word);
    return acronymLike ? word : `${word[0]}${word.slice(1).toLowerCase()}`;
  });
}

function isActivityState(state: OperationalStateValue): boolean {
  return Boolean(state.activityId && state.activityName);
}

function isSameState(left: OperationalStateValue, right: OperationalStateValue): boolean {
  return Boolean(
    left.activityId &&
    right.activityId &&
    left.activityId === right.activityId &&
    left.code === right.code,
  );
}

function stateParts(state: OperationalStateValue): { name: string; stateLabel: string | null } {
  if (isActivityState(state)) {
    return {
      name: displayActivityName(state.activityName!),
      stateLabel: stateLabels[state.code] ?? state.code,
    };
  }
  if (state.code === 'LOCKED' && state.label === 'Production Locked') {
    return { name: 'Production', stateLabel: 'Locked' };
  }
  if (state.code === 'COMPLETED' && state.label === 'Production Completed') {
    return { name: 'Production', stateLabel: 'Completed' };
  }
  return { name: state.label, stateLabel: null };
}

function secondaryLane(
  domain: OperationalPresentationLane['domain'],
  state: OperationalStateValue,
): OperationalPresentationLane {
  const parts = stateParts(state);
  return {
    domain,
    heading: domain === 'PRODUCTION' ? 'Production' : 'Quality',
    name: parts.name,
    stateLabel: parts.stateLabel,
    tone: state.tone,
  };
}

export function getJobOrderOperationalPresentation(
  state: JobOrderOperationalState,
): JobOrderOperationalPresentation {
  const primary = state.primaryDisplayState;
  const primaryParts = stateParts(primary);
  const workflowCompleted =
    primary.code === 'COMPLETED' &&
    primary.activityId === null &&
    state.productionState?.code === 'COMPLETED' &&
    (!state.qualityState || state.qualityState.code === 'COMPLETED');
  const secondaryLanes: OperationalPresentationLane[] = [];

  if (!workflowCompleted && state.productionState && !isSameState(primary, state.productionState)) {
    secondaryLanes.push(secondaryLane('PRODUCTION', state.productionState));
  }

  const qualityAddsCurrentInformation =
    state.qualityState &&
    !isSameState(primary, state.qualityState) &&
    !['COMPLETED', 'NOT_AVAILABLE'].includes(state.qualityState.code);
  if (!workflowCompleted && qualityAddsCurrentInformation) {
    secondaryLanes.push(secondaryLane('QUALITY', state.qualityState!));
  }

  return {
    heading:
      isActivityState(primary) && ['PENDING', 'READY', 'IN_PROGRESS'].includes(primary.code)
        ? 'Current Activity'
        : 'Current State',
    name: primaryParts.name,
    stateLabel: primaryParts.stateLabel,
    tone: primary.tone,
    secondaryLanes,
  };
}

/**
 * Presents the QA dimension already derived by the Job Order runtime. This is
 * intentionally not a second lifecycle: it only translates operational state
 * into a compact list label.
 */
export function getQaWorkPresentation(state: JobOrderOperationalState): QaWorkPresentation {
  if (state.lifecycleContext.code === 'READY_FOR_REINSPECTION') {
    return { label: 'Reinspection Required', tone: 'warning' };
  }
  if (state.lifecycleContext.code === 'REWORK_REQUIRED') {
    return { label: 'Rework Required', tone: 'warning' };
  }

  const quality = state.qualityState;
  if (!quality) {
    const complete = ['QA_APPROVED', 'QA_PASSED', 'CLOSED'].includes(state.lifecycleContext.code);
    return complete
      ? { label: 'QA Complete', tone: 'success' }
      : { label: 'No QA Action', tone: 'muted' };
  }

  const name = quality.activityName ? displayActivityName(quality.activityName) : quality.label;
  const suffix =
    quality.code === 'PENDING'
      ? name === 'PPM'
        ? 'Required'
        : 'Available'
      : quality.code === 'COMPLETED'
        ? 'Complete'
        : stateLabels[quality.code];
  return { label: suffix ? `${name} ${suffix}` : quality.label, tone: quality.tone };
}

/**
 * Combines the operational and quality dimensions for the QA-facing Job Order
 * list without changing either underlying state. Actionable quality work wins;
 * production is retained as secondary context only when it adds information.
 */
export function getQaStatusPresentation(state: JobOrderOperationalState): QaStatusPresentation {
  const qualityIsActionable =
    state.lifecycleContext.code === 'READY_FOR_REINSPECTION' ||
    state.lifecycleContext.code === 'REWORK_REQUIRED' ||
    Boolean(
      state.qualityState && !['COMPLETED', 'NOT_AVAILABLE'].includes(state.qualityState.code),
    );

  if (!qualityIsActionable) {
    return {
      primary: {
        label: state.primaryDisplayState.label,
        tone: state.primaryDisplayState.tone,
      },
      secondaryLabel: null,
    };
  }

  const primary = getQaWorkPresentation(state);
  const production = state.productionState;
  const productionAddsContext =
    production &&
    production.code !== 'NOT_AVAILABLE' &&
    (!state.qualityState || !isSameState(production, state.qualityState)) &&
    production.label !== primary.label;

  return {
    primary,
    secondaryLabel: productionAddsContext ? production.label.replace(/^Production\s+/i, '') : null,
  };
}
