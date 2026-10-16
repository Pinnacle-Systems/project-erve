import type { PackingAuditQueueItem } from './types.js';

/** User-facing outlet/destination provenance from the authoritative queue response. */
export function packingAuditDestinationLabel(destination: PackingAuditQueueItem['destination']): string {
  const locality = [destination.city, destination.state].filter(Boolean).join(', ');
  const label = destination.label?.trim();
  return label ? [label, locality].filter(Boolean).join(' · ') : locality;
}
