export function getCompletedStageName(metadata: unknown): string | undefined {
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
};

function sentenceCaseAction(action: string): string {
  const words = action
    .trim()
    .replaceAll('_', ' ')
    .toLowerCase()
    .trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : 'Unknown event';
}

export function formatJobOrderAuditTitle(action: string, metadata: unknown): string {
  if (action === 'JOB_ORDER_STAGE_COMPLETED') {
    const stageName = getCompletedStageName(metadata);
    return stageName
      ? `Production stage completed — ${stageName}`
      : 'Job order stage completed';
  }

  return JOB_ORDER_AUDIT_TITLES[action] ?? sentenceCaseAction(action);
}
