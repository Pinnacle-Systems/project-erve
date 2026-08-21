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

function displayActivityName(name: string): string {
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
