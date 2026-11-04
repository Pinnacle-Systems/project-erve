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
  | 'UNCERTAIN';

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

export type EwayBillLinkageState =
  | 'NONE'
  | 'LINKED_EXTERNAL'
  | 'GENERATED'
  | 'UNRECONCILED_ATTEMPT';

export type EwayBillReadinessOutcome = 'READY' | 'NOT_READY';

export type EwayBillBlockerSource =
  | 'INVOICE'
  | 'PARTY'
  | 'ITEMS'
  | 'MOVEMENT'
  | 'ASSOCIATION';

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
    /** The ACTIVE LIVE bill that satisfies the invoice, when there is one. */
    ewayBill: EwayBillAssociationSummary | null;
    /** DEMO/synthetic records: reported, but never satisfy or block a LIVE bill. */
    syntheticRecords: { activeDemoBills: number; openDemoAttempts: number };
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
    /** Always false in B1: no provider generation exists yet. */
    providerGenerationAvailable: false;
    /** Always false in B1: external-link mutation is not implemented yet. */
    externalLinkAvailable: false;
  };
  evaluatedAt: string;
}
