import type { GstIntegrationMode } from './gst-compliance.js';

// ---------------------------------------------------------------------------
// E-Way Bill foundation (Track B / B1) — persistence enums, the reusable
// goods-movement contract and the read-only readiness response.
//
// Vocabulary mirrors NIC's: transport mode 1-4 = ROAD/RAIL/AIR/SHIP and
// vehicle type R/O = REGULAR/OVER_DIMENSIONAL. Mapping to wire codes is a
// provider-adapter concern (B2), never stored here.
// ---------------------------------------------------------------------------

export type EwayBillSource = 'PROVIDER_GENERATED' | 'EXTERNALLY_LINKED';
export type EwayBillStatus = 'ACTIVE' | 'CANCELLED';
export type EwayBillTransportMode = 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
export type EwayBillVehicleType = 'REGULAR' | 'OVER_DIMENSIONAL';
export type EwayBillAttemptOutcome =
  | 'PREPARED'
  | 'DISPATCHED'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'UNCERTAIN'
  /** A DEMO attempt an Accountant explicitly closed (B2B). Never open. */
  | 'CLOSED';

/**
 * How much evidence backs a bill (B2B). SYNTHETIC_DEMO is a provider test_mode
 * result and is never statutory. UNVERIFIED_REFERENCE is a number typed in for
 * a LIVE bill generated elsewhere. PROVIDER_VERIFIED is reserved for a future
 * authorized verification and is never assigned by B2B.
 */
export type EwayBillVerificationStatus =
  | 'SYNTHETIC_DEMO'
  | 'UNVERIFIED_REFERENCE'
  | 'PROVIDER_VERIFIED';

/** BILLED_PARTY: delivered to the billed party. DIFFERENT_PARTY: a third-party consignee. */
export type EwayBillShipToArrangement = 'BILLED_PARTY' | 'DIFFERENT_PARTY';
/** SUPPLIER_REGISTERED_PREMISES: ships from the invoice's supplier address. DIFFERENT_PLACE: from the captured dispatch-from address. */
export type EwayBillDispatchFromArrangement = 'SUPPLIER_REGISTERED_PREMISES' | 'DIFFERENT_PLACE';

/**
 * E-Way-Bill-specific goods-movement information, captured per Tax Invoice and
 * independent of the physical Dispatch record. Dates are ISO calendar dates
 * (YYYY-MM-DD). null = not captured; approximateDistanceKm 0 is a valid,
 * captured value (NIC derives the distance).
 */
export interface EwayBillMovementInfo {
  transportMode: EwayBillTransportMode | null;
  vehicleNumber: string | null;
  vehicleType: EwayBillVehicleType | null;
  transporterId: string | null;
  transporterName: string | null;
  transportDocumentNumber: string | null;
  transportDocumentDate: string | null;
  approximateDistanceKm: number | null;
  /** null = not yet classified. Required, with dispatchFromArrangement, to prepare a request. */
  shipToArrangement: EwayBillShipToArrangement | null;
  dispatchFromArrangement: EwayBillDispatchFromArrangement | null;
  dispatchFrom: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    stateCode: string | null;
    postalCode: string | null;
  } | null;
}

/**
 * Statutory applicability. NOT_EVALUATED = nothing to evaluate yet (draft or
 * cancelled invoice) — explicitly NOT an exemption. UNDETERMINED = no verified
 * rule set is configured; the system never guesses.
 */
export type EwayBillApplicabilityOutcome =
  | 'APPLICABLE'
  | 'NOT_APPLICABLE'
  | 'UNDETERMINED'
  | 'NOT_EVALUATED';

/**
 * LINKED_UNVERIFIED = a LIVE bill number was entered by hand and has not been
 * verified with a provider. It is recorded, but it never satisfies statutory
 * clearance: only LINKED_EXTERNAL / GENERATED (PROVIDER_VERIFIED bills) do.
 */
export type EwayBillLinkageState =
  | 'NONE'
  | 'LINKED_UNVERIFIED'
  | 'LINKED_EXTERNAL'
  | 'GENERATED'
  | 'UNRECONCILED_ATTEMPT';

export type EwayBillReadinessOutcome = 'READY' | 'NOT_READY';

export type EwayBillBlockerSource =
  | 'INVOICE'
  | 'PARTY'
  | 'ITEMS'
  | 'MOVEMENT'
  | 'ASSOCIATION'
  /** Settings / server configuration (B2B generation gates). */
  | 'CONFIGURATION';

export interface EwayBillReason {
  code: string;
  message: string;
}

export interface EwayBillBlocker extends EwayBillReason {
  source: EwayBillBlockerSource;
  /** Contract field the blocker refers to, e.g. "recipient.gstin". */
  field: string;
  /** Affected invoice lines, for line-level blockers. */
  lineIds?: string[];
}

export interface EwayBillAssociationSummary {
  id: string;
  source: EwayBillSource;
  integrationMode: GstIntegrationMode;
  ewayBillNumber: string;
  verificationStatus: EwayBillVerificationStatus;
  generatedAt: string | null;
  validUntil: string | null;
}

/** Requirements NOT enforced because they could not be verified from an official source. */
export interface EwayBillUnverifiedRequirement extends EwayBillReason {
  /** Where the uncertainty comes from; never a claim of verification. */
  basis: string;
}

export interface EwayBillReadinessResponse {
  taxInvoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  applicability: {
    outcome: EwayBillApplicabilityOutcome;
    reasons: EwayBillReason[];
    /** null while no verified rule set exists. */
    ruleSetVersion: string | null;
  };
  linkage: {
    state: EwayBillLinkageState;
    /** The ACTIVE, PROVIDER_VERIFIED LIVE bill that satisfies the invoice, when there is one. */
    ewayBill: EwayBillAssociationSummary | null;
    /** An ACTIVE LIVE bill that was entered by hand and is not verified; never clearance. */
    unverifiedReference: EwayBillAssociationSummary | null;
    /** True only for a PROVIDER_VERIFIED LIVE bill. Demo success and unverified references never set it. */
    satisfiesStatutoryClearance: boolean;
    /** DEMO/synthetic records: reported, but never satisfy or block a LIVE bill. */
    syntheticRecords: {
      activeDemoBills: number;
      openDemoAttempts: number;
      demoBill: EwayBillAssociationSummary | null;
    };
  };
  readiness: {
    outcome: EwayBillReadinessOutcome;
    blockers: EwayBillBlocker[];
    /**
     * 'PARTIAL' until every NIC/provider requirement is verified: READY means
     * "no known blocker among the verified requirements", not "NIC will accept".
     */
    requirementsVerification: 'PARTIAL';
    unverifiedRequirements: EwayBillUnverifiedRequirement[];
  };
  /** Non-blocking review items, e.g. a live bill attached to a cancelled invoice. */
  reviewFlags: EwayBillReason[];
  capabilities: {
    /** The ewayBillGenerationEnabled application setting. */
    providerGenerationEnabled: boolean;
    /**
     * Synthetic Demo generation is possible right now: setting enabled, Demo
     * mode, server-side Demo authorization and a provider key are all present.
     * Says nothing about this invoice's readiness.
     */
    demoGenerationAvailable: boolean;
    /** Always false: no Live statutory generation or lookup exists. */
    liveGenerationAvailable: false;
    /** Recording an existing LIVE bill by hand. Independent of the Demo generation setting. */
    externalLinkAvailable: true;
  };
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// B2B operations: movement capture, generation preview, Demo generation,
// attempt recovery and external linking.
// ---------------------------------------------------------------------------

export interface EwayBillMovementRecord {
  taxInvoiceId: string;
  /** 0 = nothing captured yet; send it as expectedVersion to create the first record. */
  version: number;
  captured: boolean;
  /** All-null when nothing is captured. */
  movement: EwayBillMovementInfo;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** PUT replaces the whole movement: an omitted field is stored as null. */
export interface UpdateEwayBillMovementRequest extends Partial<EwayBillMovementInfo> {
  expectedVersion: number;
}

export interface EwayBillRequestClassification {
  transactionType: 1 | 2 | 3 | 4;
  shipTo: EwayBillShipToArrangement;
  dispatchFrom: EwayBillDispatchFromArrangement;
}

export interface EwayBillGenerationPreviewResponse {
  taxInvoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  /** EwayBillMovement.version a generate call must echo; null when none is captured. */
  movementVersion: number | null;
  applicability: EwayBillReadinessResponse['applicability'];
  /** True while applicability is UNDETERMINED: generate then needs the explicit acknowledgement. */
  acknowledgementRequired: boolean;
  /** Synthetic Demo generation. Gates are settings / configuration / existing records. */
  demo: {
    /** The GST Compliance Settings integration mode. Demo generation needs DEMO. */
    integrationMode: GstIntegrationMode;
    /** Gates clear AND the request is ready. */
    available: boolean;
    blockers: EwayBillBlocker[];
  };
  /** Live statutory generation. Never available in B2B. */
  live: {
    available: false;
    blockers: EwayBillBlocker[];
  };
  /** What would be sent: data blockers, warnings and assumptions. */
  request: {
    ready: boolean;
    blockers: EwayBillBlocker[];
    warnings: EwayBillReason[];
    assumptions: EwayBillUnverifiedRequirement[];
    classification: EwayBillRequestClassification | null;
    document: { type: 'INV'; number: string; date: string } | null;
    itemCount: number;
  };
  linkage: EwayBillReadinessResponse['linkage'];
  evaluatedAt: string;
}

export interface GenerateEwayBillDemoRequest {
  /** The EwayBillMovement.version shown in the preview; a stale value is rejected. */
  expectedMovementVersion: number;
  /** Required only while applicability is UNDETERMINED. */
  acknowledgeApplicabilityUndetermined?: boolean;
}

export interface EwayBillRecordView {
  id: string;
  source: EwayBillSource;
  status: EwayBillStatus;
  integrationMode: GstIntegrationMode;
  verificationStatus: EwayBillVerificationStatus;
  verifiedAt: string | null;
  /** DEMO numbers are synthetic whatever they look like. */
  ewayBillNumber: string;
  generatedAt: string | null;
  validUntil: string | null;
  requestAttemptId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface EwayBillAttemptView {
  id: string;
  integrationMode: GstIntegrationMode;
  outcome: EwayBillAttemptOutcome;
  /** PREPARED / DISPATCHED / UNCERTAIN: blocks another request until resolved. */
  open: boolean;
  /** An open attempt that needs a person: UNCERTAIN, or PREPARED / DISPATCHED past its review time. */
  requiresReview: boolean;
  actor: { id: string; name: string };
  document: { type: string; number: string; date: string };
  settingsVersion: number;
  movementVersion: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  reviewAfter: string | null;
  resolution: {
    by: { id: string; name: string };
    at: string;
    reason: string;
  } | null;
  ewayBillId: string | null;
}

export interface EwayBillGenerateResponse {
  outcome: 'SUCCEEDED' | 'REJECTED' | 'UNCERTAIN';
  attempt: EwayBillAttemptView;
  /** Present only for SUCCEEDED. Always SYNTHETIC_DEMO. */
  ewayBill: EwayBillRecordView | null;
  /** The provider said the (synthetic) bill already existed. Never a statutory association. */
  alreadyExisted: boolean;
  failure: { code: string; message: string } | null;
}

export interface CloseEwayBillDemoAttemptRequest {
  /** The outcome the caller saw; a different current outcome is rejected. */
  expectedOutcome: 'PREPARED' | 'DISPATCHED' | 'UNCERTAIN';
  reason: string;
}

export interface CloseEwayBillDemoAttemptResponse {
  attempt: EwayBillAttemptView;
}

export interface LinkEwayBillRequest {
  /** The 12-digit statutory E-Way Bill number. */
  ewayBillNumber: string;
}

export interface LinkEwayBillResponse {
  ewayBill: EwayBillRecordView;
}

export interface EwayBillAuditEvent {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  metadata: Record<string, unknown> | null;
}

export interface EwayBillHistoryResponse {
  taxInvoiceId: string;
  attempts: EwayBillAttemptView[];
  ewayBills: EwayBillRecordView[];
  events: EwayBillAuditEvent[];
}
