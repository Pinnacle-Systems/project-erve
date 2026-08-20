type Component = {
  type: string;
  config: unknown;
};

type RuntimeActivity = {
  id: string;
  name: string;
  code: string | null;
  status: string;
  activityType: 'PRODUCTION' | 'QUALITY';
  qualityExecutionMode: 'SEQUENTIAL_GATE' | 'IN_PROCESS' | null;
  qualityAvailabilityPolicy:
    | 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
    | 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'
    | 'PROGRESS_PERCENTAGE'
    | null;
  gateSatisfactionRequirement: 'FINALIZED' | 'OUTCOME_PASS' | null;
  executionMultiplicity: 'SINGLE' | 'BATCHED' | null;
  coverageTarget: 'PREPARED_QUANTITY' | null;
  associatedProductionActivityId: string | null;
  qualityFormVersion: {
    status: string;
    activityType: string;
    executionScope: string;
    sections: Array<{ components: Component[] }>;
  } | null;
};

export type ProcessFlowRuntimeSupport = {
  supported: boolean;
  reasons: string[];
};

const SUPPORTED_COMPONENTS = new Set([
  'SYSTEM_CONTEXT',
  'AQL_RESULT',
  'PRODUCTION_PROGRESS',
  'DEFECT_LIST',
  'CHECKLIST',
  'CORRECTIVE_ACTIONS',
  'COMMENTS',
  'INSPECTION_OUTCOME',
  'SIGNATURES',
  'ATTACHMENTS',
  'QUANTITY_RECONCILIATION',
  'TEST_RESULTS',
  'FIELD_GROUP',
  'ATTENDEE_LIST',
  'ACTION_LIST',
]);

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function unsupportedPattern(activity: RuntimeActivity): string {
  const form = activity.qualityFormVersion;
  return [
    form?.activityType ?? 'UNKNOWN_FORM_TYPE',
    form?.executionScope ?? 'UNKNOWN_SCOPE',
    activity.qualityExecutionMode ?? 'UNKNOWN_MODE',
    activity.executionMultiplicity ?? 'UNKNOWN_MULTIPLICITY',
    activity.qualityAvailabilityPolicy ?? activity.gateSatisfactionRequirement ?? 'NO_POLICY',
    activity.coverageTarget ?? 'NO_COVERAGE_TARGET',
  ].join(' / ');
}

function isSupportedPattern(activity: RuntimeActivity): boolean {
  const form = activity.qualityFormVersion;
  if (!form) return false;

  // The SIZE sequential-pass tuple is the dedicated ERVE-015 PP Sample bridge.
  if (
    form.activityType === 'INSPECTION' &&
    form.executionScope === 'SIZE' &&
    activity.qualityExecutionMode === 'SEQUENTIAL_GATE' &&
    activity.gateSatisfactionRequirement === 'OUTCOME_PASS' &&
    activity.executionMultiplicity === 'SINGLE'
  )
    return true;

  // Consolidated pre-production meeting/report gate.
  if (
    form.activityType === 'MEETING' &&
    form.executionScope === 'JOB_ORDER' &&
    activity.qualityExecutionMode === 'SEQUENTIAL_GATE' &&
    activity.gateSatisfactionRequirement === 'FINALIZED' &&
    activity.executionMultiplicity === 'SINGLE'
  )
    return true;

  if (
    form.activityType !== 'INSPECTION' ||
    form.executionScope !== 'JOB_ORDER' ||
    activity.qualityExecutionMode !== 'IN_PROCESS'
  )
    return false;

  // Consolidated Inline inspection.
  if (
    activity.executionMultiplicity === 'SINGLE' &&
    activity.qualityAvailabilityPolicy === 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
  )
    return true;

  // Consolidated, batched Final inspection.
  return (
    activity.executionMultiplicity === 'BATCHED' &&
    activity.qualityAvailabilityPolicy === 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES' &&
    activity.coverageTarget === 'PREPARED_QUANTITY'
  );
}

export function evaluateProcessFlowRuntimeSupport(version: {
  stages: RuntimeActivity[];
}): ProcessFlowRuntimeSupport {
  const reasons: string[] = [];
  const productionCodes = new Set(
    version.stages
      .filter((activity) => activity.status === 'ACTIVE' && activity.activityType === 'PRODUCTION')
      .map((activity) => activity.code)
      .filter((code): code is string => Boolean(code)),
  );

  for (const activity of version.stages) {
    if (activity.status !== 'ACTIVE' || activity.activityType !== 'QUALITY') continue;
    const prefix = `Quality activity "${activity.name}"`;
    const form = activity.qualityFormVersion;
    if (!form) {
      reasons.push(`${prefix} does not reference an exact Quality Form version.`);
      continue;
    }
    if (!isSupportedPattern(activity)) {
      reasons.push(
        `${prefix} uses an unsupported runtime pattern: ${unsupportedPattern(activity)}.`,
      );
      continue;
    }
    if (
      activity.qualityExecutionMode === 'IN_PROCESS' &&
      !activity.associatedProductionActivityId
    ) {
      reasons.push(`${prefix} does not identify its associated Production activity.`);
    }

    for (const component of form.sections.flatMap((section) => section.components)) {
      if (!SUPPORTED_COMPONENTS.has(component.type)) {
        reasons.push(`${prefix} uses unsupported form component ${component.type}.`);
        continue;
      }
      const config = component.config as Record<string, unknown>;
      if (
        component.type === 'SYSTEM_CONTEXT' &&
        records(config.fields).some((field) => typeof field.sourceKey !== 'string')
      ) {
        reasons.push(`${prefix} has a system-context field without a stable source identifier.`);
      }
      if (
        component.type === 'QUANTITY_RECONCILIATION' &&
        records(config.fields).some(
          (field) => field.source === 'SYSTEM' && typeof field.sourceKey !== 'string',
        )
      ) {
        reasons.push(`${prefix} has a system quantity without a stable source identifier.`);
      }
      if (component.type === 'PRODUCTION_PROGRESS') {
        for (const metric of records(config.metrics)) {
          if (
            typeof metric.sourceActivityCode !== 'string' ||
            !productionCodes.has(metric.sourceActivityCode)
          ) {
            reasons.push(
              `${prefix} has Production progress that cannot resolve an active activity by stable code.`,
            );
            break;
          }
        }
      }
    }
  }

  return { supported: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function assertProcessFlowRuntimeSupported(version: { stages: RuntimeActivity[] }): void {
  const support = evaluateProcessFlowRuntimeSupport(version);
  if (!support.supported) {
    const error = new Error(support.reasons.join(' '));
    error.name = 'UnsupportedProcessFlowRuntimeError';
    throw error;
  }
}
