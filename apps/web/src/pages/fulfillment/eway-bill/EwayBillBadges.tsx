import type { EwayBillAttemptOutcome, EwayBillVerificationStatus } from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import type { StatusBadgeTone } from '@erve/app-components';
import { ATTEMPT_OUTCOME_LABEL, VERIFICATION_LABEL } from './eway-bill-ui.js';

// A synthetic Demo bill is never "success"-toned and a hand-linked number is
// never verified-looking: tone follows the evidence, not the outcome.
const VERIFICATION_TONE: Record<EwayBillVerificationStatus, StatusBadgeTone> = {
  SYNTHETIC_DEMO: 'info',
  UNVERIFIED_REFERENCE: 'warning',
  PROVIDER_VERIFIED: 'success',
};

const OUTCOME_TONE: Record<EwayBillAttemptOutcome, StatusBadgeTone> = {
  PREPARED: 'warning',
  DISPATCHED: 'warning',
  SUCCEEDED: 'info',
  REJECTED: 'danger',
  UNCERTAIN: 'warning',
  CLOSED: 'muted',
};

export function VerificationBadge({ status }: { status: EwayBillVerificationStatus }) {
  return <StatusBadge label={VERIFICATION_LABEL[status]} tone={VERIFICATION_TONE[status]} />;
}

export function AttemptOutcomeBadge({ outcome }: { outcome: EwayBillAttemptOutcome }) {
  return <StatusBadge label={ATTEMPT_OUTCOME_LABEL[outcome]} tone={OUTCOME_TONE[outcome]} />;
}

export function ModeBadge({ mode }: { mode: 'DEMO' | 'LIVE' }) {
  return <StatusBadge label={mode === 'DEMO' ? 'DEMO' : 'LIVE'} tone={mode === 'DEMO' ? 'info' : 'default'} />;
}
