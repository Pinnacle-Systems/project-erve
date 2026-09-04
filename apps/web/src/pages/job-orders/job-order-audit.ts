export function getStageName(metadata: unknown): string | undefined {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const stageName = (metadata as { stageName?: unknown }).stageName;
  if (typeof stageName !== 'string') return undefined;

  const trimmed = stageName.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const JOB_ORDER_AUDIT_TITLES: Record<string, string> = {
  JOB_ORDER_CREATED: 'Job order created',
  JOB_ORDER_SENT_TO_FACTORY: 'Job order sent to factory',
  JOB_ORDER_FACTORY_CONFIRMED: 'Job order factory confirmed',
  JOB_ORDER_DISCLAIMER_SET: 'Job order disclaimer set',
  JOB_ORDER_DISCLAIMER_CHANGED: 'Job order disclaimer changed',
  JOB_ORDER_DISCLAIMER_ACKNOWLEDGED: 'Factory acknowledged disclaimer',
  JOB_ORDER_PREPARED_QUANTITY_UPDATED: 'Job order prepared quantity updated',
  QA_REWORK_REQUESTED: 'Rework requested by QA',
  QA_REWORK_ACKNOWLEDGE: 'Factory acknowledged rework',
  QA_REWORK_NOTES: 'Factory updated rework notes',
  QA_REWORK_READY: 'Factory marked rework ready for reinspection',
  QA_INSPECTION_STARTED: 'QA inspection or reinspection started',
  QA_REINSPECTION_COMPLETED: 'QA reinspection completed',
};

function sentenceCaseAction(action: string): string {
  const words = action.trim().replaceAll('_', ' ').toLowerCase().trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Unknown event';
}

function auditMetadata(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function withOutcome(title: string, metadata: Record<string, unknown>): string {
  const outcome = nonEmptyString(metadata.outcome) ?? nonEmptyString(metadata.decision);
  return outcome ? `${title} — ${outcome}` : title;
}

function activityTitle(metadata: Record<string, unknown>, fallback: string): string {
  return nonEmptyString(metadata.activityName) ?? fallback;
}

function attemptTitle(metadata: Record<string, unknown>): string {
  const attempt = positiveInteger(metadata.attemptNumber) ?? positiveInteger(metadata.cycleNumber);
  return attempt ? `PP Sample attempt ${attempt}` : 'PP Sample';
}

function finalBatchTitle(metadata: Record<string, unknown>): string {
  const batch = positiveInteger(metadata.batchNumber);
  return batch ? `Final Inspection batch ${batch}` : 'Final Inspection batch';
}

function attachmentRequirement(metadata: Record<string, unknown>): string | undefined {
  const requirement = nonEmptyString(metadata.requirementKey);
  return requirement ? sentenceCaseAction(requirement) : undefined;
}

function attachmentActivityTitle(metadata: Record<string, unknown>): string {
  const title = activityTitle(metadata, 'Quality activity');
  const batch = positiveInteger(metadata.batchNumber);
  return batch ? `${title} batch ${batch}` : title;
}

export function formatJobOrderAuditTitle(action: string, metadata: unknown): string {
  if (action === 'JOB_ORDER_STAGE_COMPLETED') {
    const stageName = getStageName(metadata);
    return stageName ? `Production stage completed — ${stageName}` : 'Job order stage completed';
  }
  if (action === 'JOB_ORDER_STAGE_STARTED') {
    const stageName = getStageName(metadata);
    return stageName ? `Production stage started — ${stageName}` : 'Job order stage started';
  }

  const details = auditMetadata(metadata);
  if (action === 'PP_SAMPLE_STARTED') return `${attemptTitle(details)} started`;
  if (action === 'PP_SAMPLE_FINALIZED') {
    return withOutcome(`${attemptTitle(details)} finalized`, details);
  }
  if (action === 'FINAL_INSPECTION_BATCH_STARTED') {
    return `${finalBatchTitle(details)} started`;
  }
  if (action === 'FINAL_INSPECTION_BATCH_FINALIZED') {
    return withOutcome(`${finalBatchTitle(details)} finalized`, details);
  }
  if (action === 'QUALITY_ACTIVITY_STARTED') {
    return `${activityTitle(details, 'Quality activity')} started`;
  }
  if (action === 'QUALITY_ACTIVITY_DRAFT_SAVED') {
    return `${activityTitle(details, 'Quality activity')} draft saved`;
  }
  if (action === 'QUALITY_ACTIVITY_FINALIZED') {
    return withOutcome(`${activityTitle(details, 'Quality activity')} finalized`, details);
  }
  if (action === 'QUALITY_ACTIVITY_ATTACHMENT_ADDED') {
    const requirement = attachmentRequirement(details);
    return requirement
      ? `${attachmentActivityTitle(details)} attachment added — ${requirement}`
      : `${attachmentActivityTitle(details)} attachment added`;
  }
  if (action === 'QUALITY_ACTIVITY_ATTACHMENT_REMOVED') {
    return `${attachmentActivityTitle(details)} attachment removed`;
  }

  return JOB_ORDER_AUDIT_TITLES[action] ?? sentenceCaseAction(action);
}
