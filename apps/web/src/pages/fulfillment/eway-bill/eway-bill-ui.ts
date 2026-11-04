import { isAxiosError } from 'axios';
import type {
  EwayBillApplicabilityOutcome,
  EwayBillAttemptOutcome,
  EwayBillAttemptView,
  EwayBillBlocker,
  EwayBillBlockerSource,
  EwayBillDispatchFromArrangement,
  EwayBillMovementInfo,
  EwayBillShipToArrangement,
  EwayBillTransportMode,
  EwayBillVehicleType,
  EwayBillVerificationStatus,
  UpdateEwayBillMovementRequest,
} from '@erve/types';
import { getApiErrorCode } from '../../../lib/api-errors.js';

// ---------------------------------------------------------------------------
// Wording. Demo vs Live, synthetic vs statutory and verified vs unverified are
// the distinctions an Accountant must never confuse, so every label lives here.
// ---------------------------------------------------------------------------

export const VERIFICATION_LABEL: Record<EwayBillVerificationStatus, string> = {
  SYNTHETIC_DEMO: 'Demo E-Way Bill — Test only',
  UNVERIFIED_REFERENCE: 'Existing E-Way Bill — Not verified',
  PROVIDER_VERIFIED: 'Provider verified',
};

export const ATTEMPT_OUTCOME_LABEL: Record<EwayBillAttemptOutcome, string> = {
  PREPARED: 'Prepared — not yet sent',
  DISPATCHED: 'Sent — awaiting result',
  SUCCEEDED: 'Demo E-Way Bill recorded',
  REJECTED: 'Rejected by provider',
  UNCERTAIN: 'Generation outcome unknown',
  CLOSED: 'Demo attempt manually closed',
};

export const APPLICABILITY_LABEL: Record<EwayBillApplicabilityOutcome, string> = {
  APPLICABLE: 'Applicable',
  NOT_APPLICABLE: 'Not applicable',
  UNDETERMINED: 'Applicability not automatically determined',
  NOT_EVALUATED: 'Not evaluated (draft or cancelled invoice)',
};

export const TRANSPORT_MODE_LABEL: Record<EwayBillTransportMode, string> = {
  ROAD: 'Road',
  RAIL: 'Rail',
  AIR: 'Air',
  SHIP: 'Ship',
};
export const VEHICLE_TYPE_LABEL: Record<EwayBillVehicleType, string> = {
  REGULAR: 'Regular',
  OVER_DIMENSIONAL: 'Over-dimensional',
};
export const SHIP_TO_LABEL: Record<EwayBillShipToArrangement, string> = {
  BILLED_PARTY: 'Billed party',
  DIFFERENT_PARTY: 'Different consignee',
};
export const DISPATCH_FROM_LABEL: Record<EwayBillDispatchFromArrangement, string> = {
  SUPPLIER_REGISTERED_PREMISES: 'Supplier registered premises',
  DIFFERENT_PLACE: 'Different dispatch location',
};

export const BLOCKER_GROUPS: { source: EwayBillBlockerSource; label: string }[] = [
  { source: 'INVOICE', label: 'Invoice' },
  { source: 'PARTY', label: 'Parties' },
  { source: 'ITEMS', label: 'Items' },
  { source: 'MOVEMENT', label: 'Movement' },
  { source: 'ASSOCIATION', label: 'Existing E-Way Bill records' },
  { source: 'CONFIGURATION', label: 'Configuration' },
];

/** Blockers from several lists, de-duplicated and grouped for display. */
export function groupBlockers(
  ...lists: readonly (readonly EwayBillBlocker[])[]
): { source: EwayBillBlockerSource; label: string; blockers: EwayBillBlocker[] }[] {
  const seen = new Set<string>();
  const unique: EwayBillBlocker[] = [];
  for (const blocker of lists.flat()) {
    const key = `${blocker.source}|${blocker.code}|${blocker.field}|${(blocker.lineIds ?? []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(blocker);
  }
  return BLOCKER_GROUPS.map((group) => ({
    ...group,
    blockers: unique.filter((blocker) => blocker.source === group.source),
  })).filter((group) => group.blockers.length > 0);
}

const AUDIT_TITLES: Record<string, string> = {
  EWAY_BILL_MOVEMENT_UPDATED: 'Movement information updated',
  EWAY_BILL_DEMO_ATTEMPT_PREPARED: 'Demo generation prepared',
  EWAY_BILL_DEMO_ATTEMPT_DISPATCHED: 'Demo request sent to provider',
  EWAY_BILL_DEMO_ATTEMPT_SUCCEEDED: 'Demo E-Way Bill recorded',
  EWAY_BILL_DEMO_ATTEMPT_REJECTED: 'Demo generation rejected',
  EWAY_BILL_DEMO_ATTEMPT_CLOSED: 'Demo attempt manually closed',
  EWAY_BILL_REFERENCE_LINKED: 'Existing E-Way Bill linked (not verified)',
};

export function ewayBillAuditTitle(action: string): string {
  return (
    AUDIT_TITLES[action] ??
    action
      .replace(/^EWAY_BILL_/, '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function formatDateTime(instant: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}

// ---------------------------------------------------------------------------
// Movement form <-> API contract.
// ---------------------------------------------------------------------------

export interface DispatchFromFormState {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  postalCode: string;
}

export interface MovementFormState {
  transportMode: EwayBillTransportMode | null;
  vehicleNumber: string;
  vehicleType: EwayBillVehicleType | null;
  transporterId: string;
  transporterName: string;
  transportDocumentNumber: string;
  transportDocumentDate: string;
  /** null = not captured; 0 is a valid captured distance. */
  approximateDistanceKm: number | null;
  shipToArrangement: EwayBillShipToArrangement | null;
  dispatchFromArrangement: EwayBillDispatchFromArrangement | null;
  dispatchFrom: DispatchFromFormState;
}

/** Field limits enforced by the B2B validation schema. */
export const MOVEMENT_LIMITS = {
  vehicleNumber: 20,
  transporterId: 15,
  transporterName: 100,
  transportDocumentNumber: 15,
  addressLine: 120,
  city: 50,
  state: 60,
  stateCode: 2,
  postalCode: 6,
  maxDistanceKm: 4000,
} as const;

export function movementToForm(movement: EwayBillMovementInfo): MovementFormState {
  return {
    transportMode: movement.transportMode,
    vehicleNumber: movement.vehicleNumber ?? '',
    vehicleType: movement.vehicleType,
    transporterId: movement.transporterId ?? '',
    transporterName: movement.transporterName ?? '',
    transportDocumentNumber: movement.transportDocumentNumber ?? '',
    transportDocumentDate: movement.transportDocumentDate ?? '',
    approximateDistanceKm: movement.approximateDistanceKm,
    shipToArrangement: movement.shipToArrangement,
    dispatchFromArrangement: movement.dispatchFromArrangement,
    dispatchFrom: {
      addressLine1: movement.dispatchFrom?.addressLine1 ?? '',
      addressLine2: movement.dispatchFrom?.addressLine2 ?? '',
      city: movement.dispatchFrom?.city ?? '',
      state: movement.dispatchFrom?.state ?? '',
      stateCode: movement.dispatchFrom?.stateCode ?? '',
      postalCode: movement.dispatchFrom?.postalCode ?? '',
    },
  };
}

const textOrNull = (value: string) => (value.trim().length === 0 ? null : value.trim());

/**
 * The PUT replaces the whole record, so the complete form state is always sent:
 * a cleared field is an explicit null, never an omitted key. The dispatch-from
 * address is sent only for a different dispatch location; the backend rejects
 * an address that contradicts the supplier-premises arrangement.
 */
export function formToMovementRequest(
  form: MovementFormState,
  expectedVersion: number,
): UpdateEwayBillMovementRequest {
  return {
    expectedVersion,
    transportMode: form.transportMode,
    vehicleNumber: textOrNull(form.vehicleNumber),
    vehicleType: form.vehicleType,
    transporterId: textOrNull(form.transporterId),
    transporterName: textOrNull(form.transporterName),
    transportDocumentNumber: textOrNull(form.transportDocumentNumber),
    transportDocumentDate: textOrNull(form.transportDocumentDate),
    approximateDistanceKm: form.approximateDistanceKm,
    shipToArrangement: form.shipToArrangement,
    dispatchFromArrangement: form.dispatchFromArrangement,
    dispatchFrom:
      form.dispatchFromArrangement === 'DIFFERENT_PLACE'
        ? {
            addressLine1: textOrNull(form.dispatchFrom.addressLine1),
            addressLine2: textOrNull(form.dispatchFrom.addressLine2),
            city: textOrNull(form.dispatchFrom.city),
            state: textOrNull(form.dispatchFrom.state),
            stateCode: textOrNull(form.dispatchFrom.stateCode),
            postalCode: textOrNull(form.dispatchFrom.postalCode),
          }
        : null,
  };
}

export function isMovementDirty(form: MovementFormState, baseline: MovementFormState): boolean {
  return (
    JSON.stringify(formToMovementRequest(form, 0)) !==
    JSON.stringify(formToMovementRequest(baseline, 0))
  );
}

// ---------------------------------------------------------------------------
// Error classification.
// ---------------------------------------------------------------------------

export function isStaleVersionError(caught: unknown): boolean {
  return getApiErrorCode(caught) === 'STALE_VERSION';
}

/**
 * True when a failed request may nevertheless have reached the provider: no
 * HTTP response at all (network failure, timeout) or a server-side failure.
 * A 4xx is a definite refusal made before anything was sent.
 */
export function isOutcomeUnknownError(caught: unknown): boolean {
  if (!isAxiosError(caught)) return true;
  const status = caught.response?.status;
  return status === undefined || status >= 500;
}

/** Per-field messages from a 400 VALIDATION_ERROR envelope, keyed by field path. */
export function getFieldErrors(caught: unknown): Record<string, string> {
  if (!isAxiosError(caught)) return {};
  const issues = caught.response?.data?.error?.details?.issues;
  if (!Array.isArray(issues)) return {};
  const result: Record<string, string> = {};
  for (const issue of issues) {
    if (typeof issue?.field === 'string' && typeof issue?.message === 'string') {
      result[issue.field] ??= issue.message;
    }
  }
  return result;
}

export function hasOpenAttempt(attempts: readonly EwayBillAttemptView[]): boolean {
  return attempts.some((attempt) => attempt.open);
}
