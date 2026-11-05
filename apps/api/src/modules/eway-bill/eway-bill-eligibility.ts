import type {
  EwayBillApplicabilityOutcome,
  EwayBillAssociationSummary,
  EwayBillAttemptOutcome,
  EwayBillBlocker,
  EwayBillLinkageState,
  EwayBillMovementInfo,
  EwayBillReadinessResponse,
  EwayBillReason,
  EwayBillSource,
  EwayBillStatus,
  EwayBillUnverifiedRequirement,
  EwayBillVerificationStatus,
  GstIntegrationMode,
} from '@erve/types';
import { isValidGstinFormat, resolveGstStateCode } from '@erve/shared';
import { toBusinessCalendarDate } from '../master-data/financial-year.util.js';

// ---------------------------------------------------------------------------
// E-Way Bill eligibility / readiness (Track B, B1). A pure, database-free
// evaluation over already-loaded facts so every outcome is unit-testable.
//
// Three deliberately independent axes (never collapsed into one boolean):
//   1. applicability — is an E-Way Bill statutorily required? Decided ONLY by
//      an injected, verified rule evaluator. With none configured the answer
//      is UNDETERMINED; thresholds/exemptions/distance rules are never guessed.
//   2. linkage — is a statutory (LIVE) bill already attached to the invoice?
//      DEMO/synthetic records are reported separately and never satisfy or
//      block a LIVE bill.
//   3. readiness — is the data needed to build a request present? Checks
//      DATA PRESENCE and a small set of rules verified against NIC's published
//      generate-E-Way-Bill rules as quoted by NIC's API documentation and
//      corroborated by GSTINAPI / ClearTax documentation (see VERIFIED RULES
//      below). Anything not verifiable is listed in unverifiedRequirements,
//      never enforced. READY therefore means "no known blocker among verified
//      requirements", not "NIC will accept the request".
//
// VERIFIED RULES (basis in parentheses):
//  - Transport mode ROAD requires a vehicle number; RAIL/AIR/SHIP require a
//    transport document number (NIC generate rules, v1.02/v1.03; GSTINAPI
//    EwbDtls notes).
//  - Distance is required; 0 is accepted and means NIC derives it (NIC
//    v1.02 required list; GSTINAPI; ClearTax).
//  - Recipient (and supplier) GSTIN is required unless the party is
//    unregistered, in which case NIC takes the literal "URP" (NIC v1.02/v1.03).
//    The supplier can never be URP.
//  - Document number: at most 16 characters, letters/digits with "/" or "-"
//    only (GSTINAPI validator guidance; ClearTax "Max Length 16").
//  - Transport document date must not be earlier than the document date
//    (NIC v1.02).
//  - Pincodes and state codes are required for the from/to parties (NIC
//    v1.02 required list); pincodes are validated only as 6 digits.
//  - CGST/SGST vs IGST totals are conditional on the invoice's own
//    INTRA/INTER GST treatment (ClearTax: Conditional).
// NOTE: docs.ewaybillgst.gov.in returned HTTP 403 to the automated fetch used
// for this work; the NIC rules above were taken from NIC page text quoted in
// search results and cross-checked against the two provider documentations.
// Re-verify against the live NIC page before B2 builds the request mapper.
// ---------------------------------------------------------------------------

export interface EwayBillFactLine {
  id: string;
  quantity: number;
  hsnCode: string | null;
  /** Decimal as string; null on any line whose finalization snapshot is incomplete. */
  taxableValue: string | null;
}

export interface EwayBillFactBill {
  id: string;
  source: EwayBillSource;
  status: EwayBillStatus;
  integrationMode: GstIntegrationMode;
  verificationStatus: EwayBillVerificationStatus;
  ewayBillNumber: string;
  generatedAt: Date | null;
  validUntil: Date | null;
}

export interface EwayBillFactAttempt {
  id: string;
  integrationMode: GstIntegrationMode;
  outcome: EwayBillAttemptOutcome;
}

export interface EwayBillFacts {
  invoice: {
    id: string;
    status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
    invoiceNumber: string | null;
    finalizedAt: Date | null;
    gstTreatment: 'INTRA' | 'INTER' | null;
    /** Decimal strings; null on DRAFT and on any invoice whose snapshot is incomplete. */
    subtotal: string | null;
    totalCgst: string | null;
    totalSgst: string | null;
    totalIgst: string | null;
    seller: { gstin: string | null; stateCode: string | null; postalCode: string | null };
    billTo: { gstin: string | null; stateCode: string | null; postalCode: string | null };
    shipTo: { state: string | null; postalCode: string | null };
  };
  lines: EwayBillFactLine[];
  movement: EwayBillMovementInfo | null;
  bills: EwayBillFactBill[];
  attempts: EwayBillFactAttempt[];
  settings: { ewayBillGenerationEnabled: boolean; integrationMode: GstIntegrationMode };
}

export interface ApplicabilityDecision {
  outcome: Exclude<EwayBillApplicabilityOutcome, 'NOT_EVALUATED'>;
  reasons: EwayBillReason[];
  ruleSetVersion: string | null;
}

/**
 * The only place statutory applicability may be decided. The default (below)
 * refuses to decide. A real implementation must be backed by a verified,
 * versioned rule set (thresholds, exemptions, state-specific rules) — adding
 * one is a business/legal decision, not a code convenience.
 */
export type EwayBillApplicabilityEvaluator = (facts: EwayBillFacts) => ApplicabilityDecision;

export const undeterminedApplicability: EwayBillApplicabilityEvaluator = () => ({
  outcome: 'UNDETERMINED',
  reasons: [
    {
      code: 'STATUTORY_RULES_NOT_CONFIGURED',
      message:
        'No verified E-Way Bill applicability rule set is configured, so applicability is not decided automatically. A person must determine whether an E-Way Bill is required.',
    },
  ],
  ruleSetVersion: null,
});

export const EWAY_BILL_UNVERIFIED_REQUIREMENTS: readonly EwayBillUnverifiedRequirement[] = [
  {
    code: 'STATUTORY_APPLICABILITY',
    message: 'Value threshold, exemptions and state-specific rules are not encoded.',
    basis: 'Not verified against an official source; deliberately left to a person.',
  },
  {
    code: 'PART_B_REQUIREMENT_AT_GENERATION',
    message:
      'Whether transport mode / vehicle / transporter ID are statutorily mandatory when the bill is generated (versus a later Part-B update) is unverified. Transport mode is required here only by this application\'s full-movement contract (MOVEMENT_TRANSPORT_MODE_MISSING); vehicle / transporter ID are enforced only by the mode-specific rules.',
    basis: 'Conflicting provider documentation; NIC page not retrievable.',
  },
  {
    code: 'DISTANCE_UPPER_BOUND',
    message: 'A maximum distance (one provider documents 4000 km) is not enforced.',
    basis: 'Single third-party source.',
  },
  {
    code: 'ADDRESS_LINES_AND_PLACE',
    message: 'Whether from/to address lines and place names are mandatory is not enforced.',
    basis: 'Not stated in retrievable documentation.',
  },
  {
    code: 'TOTAL_INVOICE_VALUE_BASIS',
    message:
      'Which invoice total NIC compares (taxable + tax versus rounded payable) and its tolerance are not enforced.',
    basis: 'Single third-party source (+/-2) and rounding policy unresolved.',
  },
  {
    code: 'SUB_SUPPLY_AND_TRANSACTION_TYPE_CODES',
    message:
      'Business-decided: every item is invoiced in PCS, OUTRIGHT and SALE_RETURN are both outward sales, and the transaction type comes from the captured bill-to / ship-to / dispatch-from arrangement. The NIC sub-supply and transaction-type codes used to express this are provider-sample assumptions, listed with every generation preview.',
    basis: 'Business decision confirmed; NIC annexure codes not retrieved from the official page.',
  },
  {
    code: 'VEHICLE_NUMBER_FORMAT',
    message: 'Vehicle number format is not validated.',
    basis: 'Format rule not verified.',
  },
];

const POSTAL_CODE = /^\d{6}$/;
const STATE_CODE = /^\d{2}$/;
export const DOCUMENT_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;
const UNREGISTERED_PARTY = 'URP';

const present = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

export const isoDate = (instant: Date): string => toBusinessCalendarDate(instant).toISOString().slice(0, 10);

function blocker(
  source: EwayBillBlocker['source'],
  field: string,
  code: string,
  message: string,
  lineIds?: string[],
): EwayBillBlocker {
  return lineIds && lineIds.length > 0
    ? { source, field, code, message, lineIds }
    : { source, field, code, message };
}

function summarize(bill: EwayBillFactBill): EwayBillAssociationSummary {
  return {
    id: bill.id,
    source: bill.source,
    integrationMode: bill.integrationMode,
    ewayBillNumber: bill.ewayBillNumber,
    verificationStatus: bill.verificationStatus,
    generatedAt: bill.generatedAt ? bill.generatedAt.toISOString() : null,
    validUntil: bill.validUntil ? bill.validUntil.toISOString() : null,
  };
}

const OPEN_ATTEMPT: readonly EwayBillAttemptOutcome[] = ['PREPARED', 'DISPATCHED', 'UNCERTAIN'];

function evaluateLinkage(facts: EwayBillFacts): EwayBillReadinessResponse['linkage'] {
  const activeLive = facts.bills.filter(
    (bill) => bill.status === 'ACTIVE' && bill.integrationMode === 'LIVE',
  );
  const openLive = facts.attempts.filter(
    (attempt) => attempt.integrationMode === 'LIVE' && OPEN_ATTEMPT.includes(attempt.outcome),
  );
  const activeDemo = facts.bills.filter(
    (bill) => bill.status === 'ACTIVE' && bill.integrationMode === 'DEMO',
  );
  const syntheticRecords = {
    activeDemoBills: activeDemo.length,
    openDemoAttempts: facts.attempts.filter(
      (attempt) => attempt.integrationMode === 'DEMO' && OPEN_ATTEMPT.includes(attempt.outcome),
    ).length,
    demoBill: activeDemo[0] ? summarize(activeDemo[0]) : null,
  };
  const bill = activeLive[0] ?? null;
  if (bill) {
    // Only a PROVIDER_VERIFIED bill is clearance. A hand-entered reference (or
    // anything not positively verified) is reported, never trusted.
    if (bill.verificationStatus === 'PROVIDER_VERIFIED') {
      return {
        state: bill.source === 'EXTERNALLY_LINKED' ? 'LINKED_EXTERNAL' : 'GENERATED',
        ewayBill: summarize(bill),
        unverifiedReference: null,
        satisfiesStatutoryClearance: true,
        syntheticRecords,
      };
    }
    return {
      state: 'LINKED_UNVERIFIED',
      ewayBill: null,
      unverifiedReference: summarize(bill),
      satisfiesStatutoryClearance: false,
      syntheticRecords,
    };
  }
  const state: EwayBillLinkageState = openLive.length > 0 ? 'UNRECONCILED_ATTEMPT' : 'NONE';
  return {
    state,
    ewayBill: null,
    unverifiedReference: null,
    satisfiesStatutoryClearance: false,
    syntheticRecords,
  };
}

function checkParties(facts: EwayBillFacts, blockers: EwayBillBlocker[]): void {
  const { seller, billTo, shipTo } = facts.invoice;

  // Supplier: a real GSTIN is always required (URP is only ever a recipient value).
  if (!present(seller.gstin)) {
    blockers.push(blocker('PARTY', 'supplier.gstin', 'SUPPLIER_GSTIN_MISSING', 'The supplier GSTIN is missing.'));
  } else if (!isValidGstinFormat(seller.gstin)) {
    blockers.push(blocker('PARTY', 'supplier.gstin', 'SUPPLIER_GSTIN_INVALID', 'The supplier GSTIN is not a valid GSTIN.'));
  }

  // Recipient: conditional — a GSTIN, or the explicit unregistered marker.
  if (!present(billTo.gstin)) {
    blockers.push(
      blocker(
        'PARTY',
        'recipient.gstin',
        'RECIPIENT_GSTIN_MISSING',
        'The recipient GSTIN is missing. NIC accepts "URP" only for an unregistered recipient, which is not inferred.',
      ),
    );
  } else if (
    billTo.gstin.trim().toUpperCase() !== UNREGISTERED_PARTY &&
    !isValidGstinFormat(billTo.gstin)
  ) {
    blockers.push(blocker('PARTY', 'recipient.gstin', 'RECIPIENT_GSTIN_INVALID', 'The recipient GSTIN is not a valid GSTIN.'));
  }

  if (!present(seller.stateCode) || !STATE_CODE.test(seller.stateCode.trim())) {
    blockers.push(blocker('PARTY', 'supplier.stateCode', 'SUPPLIER_STATE_CODE_INVALID', 'The supplier state code is missing or not a 2-digit GST state code.'));
  }
  if (!present(billTo.stateCode) || !STATE_CODE.test(billTo.stateCode.trim())) {
    blockers.push(blocker('PARTY', 'recipient.stateCode', 'RECIPIENT_STATE_CODE_INVALID', 'The recipient state code is missing or not a 2-digit GST state code (it is resolved at invoice finalization).'));
  }
  if (!present(billTo.postalCode) || !POSTAL_CODE.test(billTo.postalCode.trim())) {
    blockers.push(blocker('PARTY', 'recipient.postalCode', 'RECIPIENT_POSTAL_CODE_INVALID', 'The recipient postal code is missing or not a 6-digit pincode.'));
  }

  // Ship-to: the delivery state is free text on the invoice snapshot; only an
  // exact canonical match is accepted (no fuzzy guessing, as at finalization).
  if (!present(shipTo.state)) {
    blockers.push(blocker('PARTY', 'shipTo.state', 'SHIP_TO_STATE_MISSING', 'The ship-to state is missing.'));
  } else if (resolveGstStateCode(shipTo.state) === null) {
    blockers.push(blocker('PARTY', 'shipTo.state', 'SHIP_TO_STATE_UNRESOLVED', 'The ship-to state does not match a known GST state or union territory.'));
  }
  if (!present(shipTo.postalCode) || !POSTAL_CODE.test(shipTo.postalCode.trim())) {
    blockers.push(blocker('PARTY', 'shipTo.postalCode', 'SHIP_TO_POSTAL_CODE_INVALID', 'The ship-to postal code is missing or not a 6-digit pincode.'));
  }

  // Dispatch-from: the captured override when present, else the seller snapshot.
  const override = facts.movement?.dispatchFrom ?? null;
  const fromPostalCode = override?.postalCode ?? seller.postalCode;
  if (override && present(override.stateCode) && !STATE_CODE.test(override.stateCode.trim())) {
    blockers.push(blocker('MOVEMENT', 'dispatchFrom.stateCode', 'DISPATCH_FROM_STATE_CODE_INVALID', 'The dispatch-from state code is not a 2-digit GST state code.'));
  }
  if (!present(fromPostalCode) || !POSTAL_CODE.test(fromPostalCode.trim())) {
    blockers.push(blocker('MOVEMENT', 'dispatchFrom.postalCode', 'DISPATCH_FROM_POSTAL_CODE_INVALID', 'The dispatch-from postal code is missing or not a 6-digit pincode.'));
  }
}

function checkDocumentAndItems(facts: EwayBillFacts, blockers: EwayBillBlocker[]): void {
  const { invoice, lines } = facts;

  if (!present(invoice.invoiceNumber) || !DOCUMENT_NUMBER.test(invoice.invoiceNumber)) {
    blockers.push(blocker('INVOICE', 'document.number', 'DOCUMENT_NUMBER_INVALID', 'The invoice number is missing or is not at most 16 letters, digits, "/" or "-".'));
  }
  if (!invoice.finalizedAt) {
    blockers.push(blocker('INVOICE', 'document.date', 'DOCUMENT_DATE_MISSING', 'The invoice has no finalization date to use as the document date.'));
  }

  if (lines.length === 0) {
    blockers.push(blocker('ITEMS', 'items', 'ITEMS_MISSING', 'The invoice has no line items.'));
  }
  const missingHsn = lines.filter((line) => !present(line.hsnCode)).map((line) => line.id);
  if (missingHsn.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].hsnCode', 'ITEM_HSN_MISSING', `${missingHsn.length} line(s) have no HSN code.`, missingHsn));
  }
  const missingValue = lines.filter((line) => !present(line.taxableValue)).map((line) => line.id);
  if (missingValue.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].taxableValue', 'ITEM_TAXABLE_VALUE_MISSING', `${missingValue.length} line(s) have no taxable value.`, missingValue));
  }

  if (!present(invoice.subtotal)) {
    blockers.push(blocker('INVOICE', 'totals.taxableValue', 'INVOICE_TOTALS_MISSING', 'The invoice has no taxable total.'));
  }
  // Conditional GST components follow the invoice's own intra/inter treatment.
  if (invoice.gstTreatment === null) {
    blockers.push(blocker('INVOICE', 'totals.gstTreatment', 'GST_TREATMENT_MISSING', 'The invoice has no intra/inter-state GST treatment, so the applicable tax components cannot be determined.'));
  } else if (invoice.gstTreatment === 'INTRA') {
    if (!present(invoice.totalCgst) || !present(invoice.totalSgst)) {
      blockers.push(blocker('INVOICE', 'totals.cgstSgst', 'CGST_SGST_TOTALS_MISSING', 'An intra-state invoice needs CGST and SGST totals.'));
    }
  } else if (!present(invoice.totalIgst)) {
    blockers.push(blocker('INVOICE', 'totals.igst', 'IGST_TOTAL_MISSING', 'An inter-state invoice needs an IGST total.'));
  }
}

/** Shared with the request mapper so the two never report the same gap twice. */
export const ARRANGEMENT_NOT_CLASSIFIED_CODE = 'TRANSACTION_ARRANGEMENT_NOT_CLASSIFIED';
export const arrangementNotClassifiedBlocker = (): EwayBillBlocker =>
  blocker(
    'PARTY',
    'arrangement',
    ARRANGEMENT_NOT_CLASSIFIED_CODE,
    'Whether the goods are delivered to the billed party or a different consignee, and whether they ship from the supplier premises or a different place, has not been classified. It cannot be inferred from addresses and is never defaulted.',
  );

function checkMovement(facts: EwayBillFacts, blockers: EwayBillBlocker[]): void {
  const movement = facts.movement;
  if (!movement) {
    blockers.push(blocker('MOVEMENT', 'movement', 'MOVEMENT_NOT_CAPTURED', 'No E-Way Bill movement information has been captured for this invoice.'));
    return;
  }

  if (movement.shipToArrangement === null || movement.dispatchFromArrangement === null) {
    blockers.push(arrangementNotClassifiedBlocker());
  }

  const distance = movement.approximateDistanceKm;
  if (distance === null) {
    blockers.push(blocker('MOVEMENT', 'movement.approximateDistanceKm', 'MOVEMENT_DISTANCE_MISSING', 'The approximate distance is not captured (0 is accepted and lets NIC derive it).'));
  } else if (!Number.isInteger(distance) || distance < 0) {
    blockers.push(blocker('MOVEMENT', 'movement.approximateDistanceKm', 'MOVEMENT_DISTANCE_INVALID', 'The approximate distance must be a whole number of kilometres, 0 or more.'));
  }

  // Required by THIS application's full-movement readiness contract (the
  // supported request is prepared with a transport mode), not an
  // independently verified statutory requirement. Whether NIC permits a
  // Part-A-only bill with Part B supplied later remains unverified — see
  // PART_B_REQUIREMENT_AT_GENERATION.
  if (movement.transportMode === null) {
    blockers.push(blocker('MOVEMENT', 'movement.transportMode', 'MOVEMENT_TRANSPORT_MODE_MISSING', 'The transport mode is not captured. It is needed to prepare the supported E-Way Bill request; this is an application requirement, and whether a bill may be generated without it (Part B supplied later) is not verified.'));
  }
  if (movement.transportMode === 'ROAD' && !present(movement.vehicleNumber)) {
    blockers.push(blocker('MOVEMENT', 'movement.vehicleNumber', 'MOVEMENT_VEHICLE_NUMBER_REQUIRED', 'A vehicle number is required for road transport.'));
  }
  if (
    (movement.transportMode === 'RAIL' ||
      movement.transportMode === 'AIR' ||
      movement.transportMode === 'SHIP') &&
    !present(movement.transportDocumentNumber)
  ) {
    blockers.push(blocker('MOVEMENT', 'movement.transportDocumentNumber', 'MOVEMENT_TRANSPORT_DOCUMENT_REQUIRED', 'A transport document number is required for rail, air or ship transport.'));
  }
  if (
    movement.transportDocumentDate !== null &&
    facts.invoice.finalizedAt &&
    movement.transportDocumentDate < isoDate(facts.invoice.finalizedAt)
  ) {
    blockers.push(blocker('MOVEMENT', 'movement.transportDocumentDate', 'MOVEMENT_TRANSPORT_DOCUMENT_DATE_BEFORE_DOCUMENT_DATE', 'The transport document date cannot be earlier than the invoice date.'));
  }
}

export interface EwayBillEvaluationDeps {
  applicability?: EwayBillApplicabilityEvaluator;
  now?: () => Date;
  /**
   * Whether synthetic Demo generation is possible right now (server-side Demo
   * authorization, provider key, Demo mode and the setting). Reported in
   * capabilities only; it never changes this invoice's readiness.
   */
  demoGenerationAvailable?: boolean;
}

export function evaluateEwayBillReadiness(
  facts: EwayBillFacts,
  deps: EwayBillEvaluationDeps = {},
): EwayBillReadinessResponse {
  const applicabilityEvaluator = deps.applicability ?? undeterminedApplicability;
  const now = (deps.now ?? (() => new Date()))();
  const { invoice } = facts;

  const linkage = evaluateLinkage(facts);
  const reviewFlags: EwayBillReason[] = [];
  const blockers: EwayBillBlocker[] = [];
  let applicability: EwayBillReadinessResponse['applicability'];

  if (invoice.status === 'DRAFT') {
    applicability = {
      outcome: 'NOT_EVALUATED',
      reasons: [{ code: 'INVOICE_NOT_FINALIZED', message: 'Applicability is evaluated only after the Tax Invoice is finalized.' }],
      ruleSetVersion: null,
    };
    blockers.push(blocker('INVOICE', 'invoice.status', 'INVOICE_NOT_FINALIZED', 'The Tax Invoice is still a draft; an E-Way Bill can only be prepared after finalization.'));
  } else if (invoice.status === 'CANCELLED') {
    // Explicitly NOT "not applicable"/exempt: a cancelled invoice is simply not
    // a document an E-Way Bill may be generated against.
    applicability = {
      outcome: 'NOT_EVALUATED',
      reasons: [{ code: 'INVOICE_CANCELLED', message: 'The Tax Invoice is cancelled; applicability is not evaluated and this is not an exemption.' }],
      ruleSetVersion: null,
    };
    blockers.push(blocker('INVOICE', 'invoice.status', 'INVOICE_CANCELLED', 'The Tax Invoice is cancelled; an E-Way Bill cannot be generated against it.'));
    if (linkage.ewayBill || linkage.unverifiedReference) {
      reviewFlags.push({
        code: 'LIVE_EWAY_BILL_ON_CANCELLED_INVOICE',
        message:
          'A live E-Way Bill is still linked to this cancelled invoice. Cancelling it with the government is a separate operation this system has not performed.',
      });
    }
  } else {
    const decision = applicabilityEvaluator(facts);
    applicability = {
      outcome: decision.outcome,
      reasons: decision.reasons,
      ruleSetVersion: decision.ruleSetVersion,
    };
    if (linkage.state === 'LINKED_EXTERNAL' || linkage.state === 'GENERATED') {
      blockers.push(blocker('ASSOCIATION', 'linkage', 'EWAY_BILL_ALREADY_ASSOCIATED', 'An active live E-Way Bill is already associated with this invoice.'));
    } else if (linkage.state === 'LINKED_UNVERIFIED') {
      blockers.push(blocker('ASSOCIATION', 'linkage', 'UNVERIFIED_EWAY_BILL_REFERENCE_LINKED', 'An E-Way Bill number was recorded by hand for this invoice and has not been verified with a provider. It is not statutory clearance, and no other live bill can be associated while it is active.'));
    } else if (linkage.state === 'UNRECONCILED_ATTEMPT') {
      blockers.push(blocker('ASSOCIATION', 'linkage', 'UNRECONCILED_ATTEMPT_PENDING', 'A previous live generation attempt is unfinished or its outcome is unknown; it must be reconciled before a new request.'));
    } else {
      checkDocumentAndItems(facts, blockers);
      checkParties(facts, blockers);
      checkMovement(facts, blockers);
    }
  }

  return {
    taxInvoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceStatus: invoice.status,
    applicability,
    linkage,
    readiness: {
      outcome: blockers.length === 0 ? 'READY' : 'NOT_READY',
      blockers,
      requirementsVerification: 'PARTIAL',
      unverifiedRequirements: [...EWAY_BILL_UNVERIFIED_REQUIREMENTS],
    },
    reviewFlags,
    capabilities: {
      providerGenerationEnabled: facts.settings.ewayBillGenerationEnabled,
      demoGenerationAvailable: deps.demoGenerationAvailable ?? false,
      liveGenerationAvailable: false,
      externalLinkAvailable: true,
    },
    evaluatedAt: now.toISOString(),
  };
}
