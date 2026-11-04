import { createHash } from 'node:crypto';
import type {
  EwayBillBlocker,
  EwayBillMovementInfo,
  EwayBillReason,
  EwayBillUnverifiedRequirement,
} from '@erve/types';
import { isValidGstinFormat, resolveGstStateCode } from '@erve/shared';
import type {
  EwayBillGeneratePayload,
  EwayBillItemPayload,
} from '../../integrations/gst/eway-bill-provider.js';
import {
  DOCUMENT_NUMBER,
  evaluateEwayBillReadiness,
  isoDate,
  type EwayBillFactLine,
  type EwayBillFacts,
} from './eway-bill-eligibility.js';
import { absPaise, paiseToNumber, toPaiseHalfUp } from './eway-bill-money.js';

// ---------------------------------------------------------------------------
// Tax Invoice -> NIC generate-E-Way-Bill request (Track B / B2A).
//
// Pure and database-free. It builds a request ONLY from the finalized invoice
// snapshot, the captured E-Way-Bill movement and an explicit transaction
// arrangement; nothing is defaulted, guessed or invented. Where a value cannot
// be derived the result is a blocker (fail closed) naming the exact field.
//
// Confirmed business decisions applied here:
//  - Every line is invoiced in pieces: UQC "PCS".
//  - OUTRIGHT and SALE_RETURN are BOTH outward sales (supplyType O, docType
//    INV). SALE_RETURN is ERVE's commercial purchase-mode term, never a
//    statutory sales return (NIC sub-supply "Sales Return" is a different
//    movement), so purchaseMode is deliberately NOT read (a test pins this).
//  - transactionType comes from the bill-to / ship-to / dispatch-from
//    arrangement, never from the purchase mode.
//
// SOURCES of the NIC constraints enforced below (the official generate page,
// docs.ewaybillgst.gov.in/apidocs/version1.03/generate-eway-bill.html, returns
// HTTP 403 to this tooling, so its text was not read directly):
//  [NIC-EINV] NIC's own e-invoice sandbox, "EWB Generation by IRN" v1.03
//     (einv-apisandbox.nic.in): distance 0 / +-10% / <= 4000; road needs
//     vehicle number and type; rail/air/ship need transport document number
//     and date with vehicle fields omitted; vehicle number 4-20 alphanumeric.
//  [NIC-RULES] A published reproduction of the NIC generate schema and its
//     numbered validation rules (developer.sandbox.co.in): field limits, enums,
//     max 250 items, document date not in the future and within 180 days,
//     same-pincode distance cap, intra/inter tax split, services-only block,
//     total-value rule. NIC release notes (via search) corroborate the 180-day
//     limit and the e-invoice restriction.
//  Each blocker's message names its basis; anything NOT confirmed stays in
//  EWAY_BILL_REQUEST_ASSUMPTIONS.
//
// The B1 readiness evaluator is reused for every check it already owns, so the
// two cannot drift apart; this module only adds what request-building needs.
// ---------------------------------------------------------------------------

const UQC_PIECES = 'PCS';
const HSN_DIGITS = /^\d{4,8}$/;
const TRANSPORTER_ID = /^[0-9]{2}[0-9A-Z]{13}$/;
const TRANSPORT_DOCUMENT_NUMBER = /^[A-Za-z0-9/-]{1,15}$/;
const VEHICLE_NUMBER = /^[A-Z0-9]{4,20}$/;

const MAX_ITEMS = 250;
const MAX_DISTANCE_KM = 4000;
const SAME_PINCODE_MAX_DISTANCE_KM = 100;
const MAX_DOCUMENT_AGE_DAYS = 180;
const MIN_PINCODE = 100_000;
const MAX_PINCODE = 999_999;
/** Tolerated difference between rounded and exact aggregates, in paise. */
const ROUNDING_TOLERANCE_PAISE = 1n;
/** Tolerated difference between derived otherValue and the stored round-off, in paise. */
const ROUND_OFF_TOLERANCE_PAISE = 2n;

const FIELD_LIMITS = { address: 120, place: 50, name: 100 } as const;

/**
 * An explicit, typed classification of who receives the goods and where they
 * leave from. The invoice snapshot carries no ship-to party identity (no
 * GSTIN), so this cannot be inferred from addresses: it must be captured and
 * is then cross-checked against the data. Missing -> blocker.
 */
export interface EwayBillArrangement {
  /** BILLED_PARTY: delivered to the party billed. DIFFERENT_PARTY: a third-party consignee. */
  shipTo: 'BILLED_PARTY' | 'DIFFERENT_PARTY';
  /** SUPPLIER_REGISTERED_PREMISES: ships from the invoice's supplier address. DIFFERENT_PLACE: from the captured dispatch-from address. */
  dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' | 'DIFFERENT_PLACE';
}

export interface EwayBillRequestLineFacts extends EwayBillFactLine {
  /** Decimal as string, e.g. "5.00"; null on a line whose snapshot is incomplete. */
  gstPercent: string | null;
  /** From the issued document snapshot; null on legacy invoices without one. */
  productName: string | null;
  productDescription: string | null;
}

export interface EwayBillRequestFacts {
  invoice: {
    id: string;
    status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
    invoiceNumber: string | null;
    finalizedAt: Date | null;
    /** Carried for traceability only. Never used to classify the request. */
    purchaseMode: 'OUTRIGHT' | 'SALE_RETURN';
    /** Snapshot of the supplier's e-invoice applicability at finalization. */
    sellerEinvoiceApplicable: boolean;
    gstTreatment: 'INTRA' | 'INTER' | null;
    subtotal: string | null;
    totalCgst: string | null;
    totalSgst: string | null;
    totalIgst: string | null;
    /** Frozen at finalization; null on legacy invoices. */
    payableTotal: string | null;
    roundOffAdjustment: string | null;
    seller: {
      legalName: string;
      tradeName: string | null;
      gstin: string | null;
      stateCode: string | null;
      postalCode: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
    };
    billTo: {
      name: string;
      gstin: string | null;
      stateCode: string | null;
      postalCode: string | null;
    };
    shipTo: {
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
    };
  };
  lines: EwayBillRequestLineFacts[];
  movement: EwayBillMovementInfo | null;
  arrangement: EwayBillArrangement | null;
}

export interface EwayBillRequestClassification {
  transactionType: 1 | 2 | 3 | 4;
  shipTo: EwayBillArrangement['shipTo'];
  dispatchFrom: EwayBillArrangement['dispatchFrom'];
}

/**
 * What stands between this request and a LIVE statutory E-Way Bill. Always
 * present, on success and failure alike, so a future Live integration cannot
 * obtain a payload without being handed these. Preparing a Demo request never
 * satisfies any of them.
 */
export interface EwayBillLiveGate {
  blockers: EwayBillBlocker[];
}

export type EwayBillRequestPreparation =
  | {
      ok: true;
      payload: EwayBillGeneratePayload;
      /** SHA-256 over the canonical payload. Credentials are never part of it. */
      fingerprint: string;
      document: { type: 'INV'; number: string; date: string };
      classification: EwayBillRequestClassification;
      warnings: EwayBillReason[];
      assumptions: readonly EwayBillUnverifiedRequirement[];
      live: EwayBillLiveGate;
    }
  | {
      ok: false;
      blockers: EwayBillBlocker[];
      warnings: EwayBillReason[];
      assumptions: readonly EwayBillUnverifiedRequirement[];
      live: EwayBillLiveGate;
    };

/**
 * The single question a Live caller must ask. False for every Demo-only
 * preparation (B2): the Live gate always carries LIVE_GENERATION_NOT_AUTHORIZED.
 */
export function isLiveGenerationPermitted(preparation: EwayBillRequestPreparation): boolean {
  return preparation.ok && preparation.live.blockers.length === 0;
}

/**
 * Behaviour that is applied or relied on but NOT confirmed by NIC / the
 * provider. Reported with every preparation so a reviewer sees it, never hidden.
 */
export const EWAY_BILL_REQUEST_ASSUMPTIONS: readonly EwayBillUnverifiedRequirement[] = [
  {
    code: 'SUB_SUPPLY_TYPE_CODE',
    message: 'subSupplyType "1" is used as "Supply" for every purchase mode.',
    basis: 'GSTINAPI and GSP samples only; the NIC sub-supply annexure was not retrieved. supplyType "O" and docType "INV" are confirmed NIC enum values.',
  },
  {
    code: 'TRANSACTION_TYPE_CODES',
    message:
      'transactionType 1-4 (Regular, Bill To-Ship To, Bill From-Dispatch From, Combination) and the fields used for a different consignee are not confirmed. For a different ship-to party only the delivery address is sent: no separate ship-to GSTIN or trade name.',
    basis: 'NIC transaction-type annexure not retrieved; codes per ClearTax. A mandatory ship-to GSTIN has been reported as on hold (unverified).',
  },
  {
    code: 'VALUATION_BASIS',
    message:
      'totalValue is the sum of the 2-decimal-rounded line taxable values, totInvValue the frozen payable total, otherValue the derived round-off. This satisfies NIC\'s "sum of values <= totInvValue (+2 rupees)" exactly; whether the GSTR-1 reporting of these fields matches is unconfirmed.',
    basis: 'NIC total-value rule confirmed; the payable-total basis is an application choice.',
  },
  {
    code: 'DISTANCE_PIN_TOLERANCE',
    message: 'A non-zero distance must be within +-10% of NIC\'s stored PIN-to-PIN distance; this cannot be checked here and the provider will refuse it.',
    basis: 'NIC distance table is not available to the application.',
  },
  {
    code: 'ALLOWED_TAX_RATES',
    message: 'NIC accepts only its list of tax rates; the list is not encoded and rates are sent as invoiced.',
    basis: 'List not retrieved.',
  },
  {
    code: 'HSN_VALIDITY',
    message: 'HSN codes are checked as 4 to 8 digits without a leading zero (NIC takes a number); validity against the GST master is checked by NIC.',
    basis: 'Application rule on top of NIC\'s numeric hsnCode.',
  },
  {
    code: 'SUPPLIER_REGISTRATION_RESTRICTIONS',
    message: 'NIC refuses TDS/TCS GSTINs and enrolled transporters as supplier or buyer; the data model does not identify them.',
    basis: 'NIC rules (reproduction); not detectable here.',
  },
  {
    code: 'VEHICLE_NUMBER_FORMAT',
    message: 'Only 4-20 alphanumeric characters are enforced; NIC also checks the Indian format and the Vahan database.',
    basis: 'NIC states 4-20 characters; a reproduction states 7-15.',
  },
];

const present = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

const trimmed = (value: string | null | undefined): string | undefined =>
  present(value) ? value.trim() : undefined;

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

/** "YYYY-MM-DD" -> "DD/MM/YYYY". */
const ddmmyyyy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const pincodeInRange = (pincode: string): boolean => {
  const value = Number(pincode);
  return Number.isInteger(value) && value >= MIN_PINCODE && value <= MAX_PINCODE;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function fingerprintPayload(payload: EwayBillGeneratePayload): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function toReadinessFacts(facts: EwayBillRequestFacts): EwayBillFacts {
  const { invoice } = facts;
  return {
    invoice: {
      id: invoice.id,
      status: invoice.status,
      invoiceNumber: invoice.invoiceNumber,
      finalizedAt: invoice.finalizedAt,
      gstTreatment: invoice.gstTreatment,
      subtotal: invoice.subtotal,
      totalCgst: invoice.totalCgst,
      totalSgst: invoice.totalSgst,
      totalIgst: invoice.totalIgst,
      seller: {
        gstin: invoice.seller.gstin,
        stateCode: invoice.seller.stateCode,
        postalCode: invoice.seller.postalCode,
      },
      billTo: {
        gstin: invoice.billTo.gstin,
        stateCode: invoice.billTo.stateCode,
        postalCode: invoice.billTo.postalCode,
      },
      shipTo: { state: invoice.shipTo.state, postalCode: invoice.shipTo.postalCode },
    },
    lines: facts.lines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      hsnCode: line.hsnCode,
      taxableValue: line.taxableValue,
    })),
    movement: facts.movement,
    // Association / attempt state is checked separately against live data.
    bills: [],
    attempts: [],
    settings: { ewayBillGenerationEnabled: false },
  };
}

interface Origin {
  addr1?: string;
  addr2?: string;
  place?: string;
  pincode: string;
  stateCode: string;
}

const TRANSPORT_MODE_CODE = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' } as const;
const VEHICLE_TYPE_CODE = { REGULAR: 'R', OVER_DIMENSIONAL: 'O' } as const;

export function prepareEwayBillRequest(
  facts: EwayBillRequestFacts,
  deps: { now?: () => Date } = {},
): EwayBillRequestPreparation {
  const { invoice, lines, movement, arrangement } = facts;
  const now = (deps.now ?? (() => new Date()))();
  const warnings: EwayBillReason[] = [];

  // Live gate: independent of whether a Demo payload can be built.
  const live: EwayBillLiveGate = {
    blockers: [
      blocker(
        'INVOICE',
        'integrationMode',
        'LIVE_GENERATION_NOT_AUTHORIZED',
        'Only Demo preparation exists. A Demo result is synthetic and never statutory clearance; Live generation needs its own approved, separately authorized integration.',
      ),
    ],
  };
  const recipientGstin = invoice.billTo.gstin?.trim().toUpperCase() ?? '';
  if (invoice.sellerEinvoiceApplicable && recipientGstin !== 'URP') {
    live.blockers.push(
      blocker(
        'INVOICE',
        'supplier.einvoiceApplicable',
        'EINVOICE_ENABLED_SUPPLIER_DIRECT_GENERATION_RESTRICTED',
        'The supplier is e-invoice applicable: NIC does not allow the Generate E-Way Bill API to be used directly for its B2B / export invoices dated on or after 1 October 2020. The E-Way Bill must be generated through the IRN (e-invoice) route, which is not implemented.',
      ),
    );
  }

  // 1. Everything B1 already owns (status, document identity, party / item /
  //    movement data presence, mode-specific transport rules).
  const readiness = evaluateEwayBillReadiness(toReadinessFacts(facts), { now: () => now });
  const blockers: EwayBillBlocker[] = [...readiness.readiness.blockers];
  const fail = (): EwayBillRequestPreparation => ({
    ok: false,
    blockers,
    warnings,
    assumptions: EWAY_BILL_REQUEST_ASSUMPTIONS,
    live,
  });
  if (invoice.status !== 'FINALIZED') return fail();

  // 2. Document identity and age.
  const documentNumber = invoice.invoiceNumber?.trim() ?? '';
  const documentDateIso = invoice.finalizedAt ? isoDate(invoice.finalizedAt) : null;
  if (documentDateIso && documentNumber && DOCUMENT_NUMBER.test(documentNumber)) {
    const ageDays = Math.floor(
      (Date.parse(isoDate(now)) - Date.parse(documentDateIso)) / 86_400_000,
    );
    if (ageDays < 0) {
      blockers.push(blocker('INVOICE', 'document.date', 'DOCUMENT_DATE_IN_FUTURE', 'The document date cannot be later than the current date (NIC).'));
    } else if (ageDays > MAX_DOCUMENT_AGE_DAYS) {
      blockers.push(blocker('INVOICE', 'document.date', 'DOCUMENT_TOO_OLD', `The invoice is ${ageDays} days old; NIC does not generate an E-Way Bill more than ${MAX_DOCUMENT_AGE_DAYS} days after the document date.`));
    }
  }

  // 3. Supplier and dispatch-from.
  const { seller, billTo, shipTo } = invoice;
  const supplierState = trimmed(seller.stateCode);
  let origin: Origin | null = null;
  const override = movement?.dispatchFrom ?? null;
  if (override) {
    // The captured dispatch-from is used as a whole unit, never merged field
    // by field with the supplier address (that would invent a mixed address).
    const stateCode = trimmed(override.stateCode) ?? resolveGstStateCode(override.state);
    const missing = [
      ['addressLine1', trimmed(override.addressLine1)],
      ['city', trimmed(override.city)],
      ['postalCode', trimmed(override.postalCode)],
      ['stateCode', stateCode],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      blockers.push(
        blocker(
          'MOVEMENT',
          'movement.dispatchFrom',
          'DISPATCH_FROM_INCOMPLETE',
          `A dispatch-from address was captured but is missing: ${missing.join(', ')}. Complete it or remove it to ship from the supplier address.`,
        ),
      );
    } else {
      origin = {
        addr1: trimmed(override.addressLine1),
        addr2: trimmed(override.addressLine2),
        place: trimmed(override.city),
        pincode: trimmed(override.postalCode)!,
        stateCode: stateCode!,
      };
    }
  } else if (supplierState && trimmed(seller.postalCode)) {
    origin = {
      addr1: trimmed(seller.addressLine1),
      addr2: trimmed(seller.addressLine2),
      place: trimmed(seller.city),
      pincode: trimmed(seller.postalCode)!,
      stateCode: supplierState,
    };
    // The supplier address is required, not optional: never silently omitted.
    if (!origin.addr1) {
      blockers.push(blocker('PARTY', 'supplier.addressLine1', 'SUPPLIER_ADDRESS_LINE1_MISSING', 'The supplier address line 1 is missing; it is required in the request and is never invented.'));
    }
    if (!origin.place) {
      blockers.push(blocker('PARTY', 'supplier.city', 'SUPPLIER_PLACE_MISSING', 'The supplier place (city) is missing; it is required in the request and is never invented.'));
    }
  }
  if (origin && !pincodeInRange(origin.pincode)) {
    blockers.push(blocker('MOVEMENT', 'dispatchFrom.postalCode', 'DISPATCH_FROM_PINCODE_OUT_OF_RANGE', 'The dispatch-from pincode must be between 100000 and 999999.'));
  }
  if (
    seller.gstin &&
    isValidGstinFormat(seller.gstin) &&
    supplierState &&
    seller.gstin.slice(0, 2) !== supplierState
  ) {
    warnings.push({
      code: 'SUPPLIER_STATE_CODE_GSTIN_MISMATCH',
      message: 'The supplier state code differs from the first two digits of the supplier GSTIN.',
    });
  }

  // 4. Recipient and delivery location.
  const billToStateCode = trimmed(billTo.stateCode);
  const shipToStateCode = resolveGstStateCode(shipTo.state);
  if (
    recipientGstin !== 'URP' &&
    isValidGstinFormat(recipientGstin) &&
    billToStateCode &&
    recipientGstin.slice(0, 2) !== billToStateCode
  ) {
    warnings.push({
      code: 'RECIPIENT_STATE_CODE_GSTIN_MISMATCH',
      message: 'The recipient state code differs from the first two digits of the recipient GSTIN.',
    });
  }
  if (!trimmed(shipTo.addressLine1)) {
    blockers.push(blocker('PARTY', 'shipTo.addressLine1', 'RECIPIENT_ADDRESS_LINE1_MISSING', 'The ship-to address line 1 is missing; it is required in the request and is never invented.'));
  }
  if (!trimmed(shipTo.city)) {
    blockers.push(blocker('PARTY', 'shipTo.city', 'RECIPIENT_PLACE_MISSING', 'The ship-to place (city) is missing; it is required in the request and is never invented.'));
  }
  if (trimmed(shipTo.postalCode) && !pincodeInRange(trimmed(shipTo.postalCode)!)) {
    blockers.push(blocker('PARTY', 'shipTo.postalCode', 'RECIPIENT_PINCODE_OUT_OF_RANGE', 'The ship-to pincode must be between 100000 and 999999.'));
  }

  // 5. Transaction type from an explicit, cross-checked arrangement.
  let transactionType: 1 | 2 | 3 | 4 | null = null;
  if (!arrangement) {
    blockers.push(blocker('PARTY', 'arrangement', 'TRANSACTION_ARRANGEMENT_NOT_CLASSIFIED', 'Whether the goods are delivered to the billed party or a different consignee, and whether they ship from the supplier premises or a different place, has not been classified. It cannot be inferred from addresses and is never defaulted.'));
  } else {
    let consistent = true;
    if (arrangement.dispatchFrom === 'DIFFERENT_PLACE' && !override) {
      consistent = false;
      blockers.push(blocker('MOVEMENT', 'arrangement.dispatchFrom', 'DISPATCH_FROM_ARRANGEMENT_UNSUPPORTED', 'The arrangement says goods ship from a different place but no dispatch-from address is captured.'));
    }
    if (arrangement.dispatchFrom === 'SUPPLIER_REGISTERED_PREMISES' && override) {
      consistent = false;
      blockers.push(blocker('MOVEMENT', 'arrangement.dispatchFrom', 'DISPATCH_FROM_ARRANGEMENT_CONTRADICTED', 'The arrangement says goods ship from the supplier premises but a dispatch-from address is captured. Remove the address or classify the dispatch as a different place.'));
    }
    if (
      arrangement.shipTo === 'BILLED_PARTY' &&
      shipToStateCode !== null &&
      billToStateCode !== undefined &&
      shipToStateCode !== billToStateCode
    ) {
      consistent = false;
      blockers.push(blocker('PARTY', 'arrangement.shipTo', 'TRANSACTION_ARRANGEMENT_AMBIGUOUS', 'The arrangement says the goods go to the billed party, but the delivery state differs from the billed party\'s state. Classify the consignee as a different party or correct the data.'));
    }
    if (consistent) {
      const differentParty = arrangement.shipTo === 'DIFFERENT_PARTY';
      const differentPlace = arrangement.dispatchFrom === 'DIFFERENT_PLACE';
      transactionType = differentParty ? (differentPlace ? 4 : 2) : differentPlace ? 3 : 1;
    }
  }

  // 6. Items.
  const itemPaise: bigint[] = [];
  const badHsn: string[] = [];
  const leadingZeroHsn: string[] = [];
  const badQuantity: string[] = [];
  const badValue: string[] = [];
  const missingRate: string[] = [];
  const missingName: string[] = [];
  const longName: string[] = [];
  const longDescription: string[] = [];
  const items: EwayBillItemPayload[] = [];
  for (const line of lines) {
    const hsn = trimmed(line.hsnCode);
    if (hsn && !HSN_DIGITS.test(hsn)) badHsn.push(line.id);
    else if (hsn && hsn.startsWith('0')) leadingZeroHsn.push(line.id);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) badQuantity.push(line.id);
    const paise = present(line.taxableValue) ? toPaiseHalfUp(line.taxableValue) : null;
    if (present(line.taxableValue) && (paise === null || paise < 0n)) badValue.push(line.id);
    const percent = present(line.gstPercent) ? Number(line.gstPercent) : Number.NaN;
    if (!Number.isFinite(percent) || percent < 0) missingRate.push(line.id);
    const productName = trimmed(line.productName);
    const productDescription = trimmed(line.productDescription);
    if (!productName) missingName.push(line.id);
    else if (productName.length > FIELD_LIMITS.name) longName.push(line.id);
    if (productDescription && productDescription.length > FIELD_LIMITS.name) longDescription.push(line.id);
    if (paise !== null && paise >= 0n) itemPaise.push(paise);

    const rate = Number.isFinite(percent) ? percent : 0;
    const half = Math.round((rate / 2) * 10_000) / 10_000;
    const isInter = invoice.gstTreatment === 'INTER';
    items.push({
      productName: productName ?? '',
      ...(productDescription ? { productDesc: productDescription } : {}),
      hsnCode: hsn && HSN_DIGITS.test(hsn) ? Number(hsn) : 0,
      quantity: line.quantity,
      qtyUnit: UQC_PIECES,
      cgstRate: isInter ? 0 : half,
      sgstRate: isInter ? 0 : half,
      igstRate: isInter ? rate : 0,
      cessRate: 0,
      cessNonadvol: 0,
      taxableAmount: paise !== null ? paiseToNumber(paise) : 0,
    });
  }
  if (lines.length > MAX_ITEMS) {
    blockers.push(blocker('ITEMS', 'items', 'ITEMS_EXCEED_MAXIMUM', `The invoice has ${lines.length} lines; NIC accepts at most ${MAX_ITEMS} items per E-Way Bill. The invoice is not split automatically.`));
  }
  if (badHsn.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].hsnCode', 'ITEM_HSN_FORMAT_INVALID', `${badHsn.length} line(s) have an HSN code that is not 4 to 8 digits.`, badHsn));
  }
  if (leadingZeroHsn.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].hsnCode', 'ITEM_HSN_LEADING_ZERO', `${leadingZeroHsn.length} line(s) have an HSN code with a leading zero, which cannot be represented exactly because NIC takes hsnCode as a number.`, leadingZeroHsn));
  }
  if (
    lines.length > 0 &&
    lines.every((line) => trimmed(line.hsnCode)?.startsWith('99'))
  ) {
    blockers.push(blocker('ITEMS', 'items[].hsnCode', 'ITEMS_SERVICES_ONLY', 'Every line carries a services (SAC 99) code; NIC does not generate an E-Way Bill unless at least one item is goods.'));
  }
  if (badQuantity.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].quantity', 'ITEM_QUANTITY_INVALID', `${badQuantity.length} line(s) have a quantity that is not a positive whole number.`, badQuantity));
  }
  if (badValue.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].taxableValue', 'ITEM_TAXABLE_VALUE_INVALID', `${badValue.length} line(s) have a taxable value that is not a non-negative amount.`, badValue));
  }
  if (missingRate.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].gstPercent', 'ITEM_GST_PERCENT_MISSING', `${missingRate.length} line(s) have no GST percentage.`, missingRate));
  }
  if (missingName.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].productName', 'ITEM_PRODUCT_NAME_MISSING', `${missingName.length} line(s) have no product name in the issued document snapshot (legacy invoices have none); a description is not invented.`, missingName));
  }
  if (longName.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].productName', 'FIELD_TOO_LONG', `${longName.length} line(s) have a product name over ${FIELD_LIMITS.name} characters (NIC limit); it is not truncated.`, longName));
  }
  if (longDescription.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].productDesc', 'FIELD_TOO_LONG', `${longDescription.length} line(s) have a product description over ${FIELD_LIMITS.name} characters (NIC limit); it is not truncated.`, longDescription));
  }

  // 7. Valuation.
  let totalValue: bigint | null = null;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  let other: bigint | null = null;
  let payable: bigint | null = null;
  if (badValue.length === 0 && itemPaise.length === lines.length && lines.length > 0) {
    totalValue = itemPaise.reduce((sum, value) => sum + value, 0n);
    const subtotal = present(invoice.subtotal) ? toPaiseHalfUp(invoice.subtotal) : null;
    if (subtotal === null) {
      if (present(invoice.subtotal)) {
        blockers.push(blocker('INVOICE', 'totals.taxableValue', 'INVOICE_AMOUNT_INVALID', 'The invoice taxable total is not a valid amount.'));
      }
    } else if (absPaise(totalValue - subtotal) > ROUNDING_TOLERANCE_PAISE) {
      blockers.push(blocker('INVOICE', 'totals.taxableValue', 'VALUATION_ROUNDING_MISMATCH', 'The sum of the rounded line taxable values differs from the invoice taxable total by more than one paisa; no adjustment is made silently.'));
    }
    const component = (name: string, value: string | null): bigint | null => {
      if (!present(value)) return null; // Presence is B1's blocker.
      const parsed = toPaiseHalfUp(value);
      if (parsed === null) {
        blockers.push(blocker('INVOICE', `totals.${name}`, 'INVOICE_AMOUNT_INVALID', `The invoice ${name} total is not a valid amount.`));
      }
      return parsed;
    };
    if (invoice.gstTreatment === 'INTRA') {
      cgst = component('cgst', invoice.totalCgst) ?? 0n;
      sgst = component('sgst', invoice.totalSgst) ?? 0n;
    } else if (invoice.gstTreatment === 'INTER') {
      igst = component('igst', invoice.totalIgst) ?? 0n;
    }
    if (!present(invoice.payableTotal)) {
      blockers.push(blocker('INVOICE', 'totals.payableTotal', 'PAYABLE_TOTAL_MISSING', 'The invoice has no frozen payable total (legacy invoices predate it); the invoice value is not recomputed.'));
    } else {
      payable = toPaiseHalfUp(invoice.payableTotal);
      if (payable === null) {
        blockers.push(blocker('INVOICE', 'totals.payableTotal', 'INVOICE_AMOUNT_INVALID', 'The invoice payable total is not a valid amount.'));
      }
    }
    if (!present(invoice.roundOffAdjustment)) {
      blockers.push(blocker('INVOICE', 'totals.roundOffAdjustment', 'ROUND_OFF_ADJUSTMENT_MISSING', 'The invoice has no frozen round-off adjustment to cross-check the derived other value.'));
    } else if (payable !== null) {
      const roundOff = toPaiseHalfUp(invoice.roundOffAdjustment);
      other = payable - (totalValue + cgst + sgst + igst);
      if (roundOff === null || absPaise(other - roundOff) > ROUND_OFF_TOLERANCE_PAISE) {
        blockers.push(blocker('INVOICE', 'totals.roundOffAdjustment', 'VALUATION_ROUND_OFF_MISMATCH', 'The payable total does not reconcile with the taxable value, taxes and the stored round-off adjustment.'));
      }
    }
  }
  // NIC: same state -> CGST + SGST; different state (or an SEZ party) -> IGST.
  // The SEZ status of a party is not modelled, so an inter-state treatment
  // within one state cannot be justified and is blocked rather than assumed.
  if (supplierState && billToStateCode && invoice.gstTreatment) {
    const sameState = supplierState === billToStateCode;
    if (invoice.gstTreatment === 'INTRA' && !sameState) {
      blockers.push(blocker('INVOICE', 'totals.gstTreatment', 'GST_TREATMENT_STATE_MISMATCH', 'The invoice is intra-state (CGST + SGST) but the supplier and recipient states differ; NIC requires IGST between different states.'));
    } else if (invoice.gstTreatment === 'INTER' && sameState) {
      blockers.push(blocker('INVOICE', 'totals.gstTreatment', 'GST_TREATMENT_STATE_MISMATCH', 'The invoice is inter-state (IGST) but the supplier and recipient are in the same state; NIC requires CGST + SGST within a state unless a party is in an SEZ, which is not modelled.'));
    }
  }

  // 8. Transport.
  const mode = movement?.transportMode ?? null;
  const vehicleNumber = trimmed(movement?.vehicleNumber)?.toUpperCase().replace(/[\s-]/g, '');
  if (movement && mode === 'ROAD') {
    if (movement.vehicleType === null) {
      blockers.push(blocker('MOVEMENT', 'movement.vehicleType', 'MOVEMENT_VEHICLE_TYPE_REQUIRED', 'A vehicle type is required for road transport (NIC) and is never defaulted.'));
    }
    if (vehicleNumber && !VEHICLE_NUMBER.test(vehicleNumber)) {
      blockers.push(blocker('MOVEMENT', 'movement.vehicleNumber', 'MOVEMENT_VEHICLE_NUMBER_INVALID', 'The vehicle number must be 4 to 20 letters or digits (NIC); the format and Vahan registration are checked by NIC.'));
    }
  }
  const distance = movement?.approximateDistanceKm ?? null;
  if (distance !== null && Number.isInteger(distance) && distance >= 0) {
    if (distance > MAX_DISTANCE_KM) {
      blockers.push(blocker('MOVEMENT', 'movement.approximateDistanceKm', 'MOVEMENT_DISTANCE_EXCEEDS_MAXIMUM', `NIC does not accept a distance above ${MAX_DISTANCE_KM} km.`));
    }
    const toPincode = trimmed(shipTo.postalCode);
    if (origin && toPincode && origin.pincode === toPincode && distance > SAME_PINCODE_MAX_DISTANCE_KM) {
      blockers.push(blocker('MOVEMENT', 'movement.approximateDistanceKm', 'MOVEMENT_DISTANCE_EXCEEDS_SAME_PINCODE_LIMIT', `The dispatch and delivery pincodes are the same; NIC allows at most ${SAME_PINCODE_MAX_DISTANCE_KM} km (300 km only for Line Sales, which is not modelled).`));
    }
  }
  const transDocNo = trimmed(movement?.transportDocumentNumber);
  if (transDocNo && !TRANSPORT_DOCUMENT_NUMBER.test(transDocNo)) {
    blockers.push(blocker('MOVEMENT', 'movement.transportDocumentNumber', 'MOVEMENT_TRANSPORT_DOCUMENT_INVALID', 'The transport document number must be at most 15 letters, digits, "/" or "-" (NIC).'));
  }
  const transporterId = trimmed(movement?.transporterId)?.toUpperCase();
  if (transporterId && !TRANSPORTER_ID.test(transporterId)) {
    blockers.push(blocker('MOVEMENT', 'movement.transporterId', 'MOVEMENT_TRANSPORTER_ID_INVALID', 'The transporter ID must be a 15-character GSTIN / TRANSIN: two digits followed by 13 letters or digits (NIC).'));
  }

  // 9. Field length limits: reported, never truncated.
  const longFields: Array<[string, string | undefined, number]> = [
    ['supplier.name', trimmed(seller.tradeName) ?? seller.legalName.trim(), FIELD_LIMITS.name],
    ['supplier.addressLine1', origin?.addr1, FIELD_LIMITS.address],
    ['supplier.addressLine2', origin?.addr2, FIELD_LIMITS.address],
    ['supplier.place', origin?.place, FIELD_LIMITS.place],
    ['recipient.name', trimmed(billTo.name), FIELD_LIMITS.name],
    ['shipTo.addressLine1', trimmed(shipTo.addressLine1), FIELD_LIMITS.address],
    ['shipTo.addressLine2', trimmed(shipTo.addressLine2), FIELD_LIMITS.address],
    ['shipTo.place', trimmed(shipTo.city), FIELD_LIMITS.place],
    ['movement.transporterName', trimmed(movement?.transporterName), FIELD_LIMITS.name],
  ];
  for (const [field, value, max] of longFields) {
    if (value && value.length > max) {
      blockers.push(blocker('PARTY', field, 'FIELD_TOO_LONG', `${field} is longer than the NIC limit of ${max} characters; it is not truncated.`));
    }
  }

  if (blockers.length > 0 || transactionType === null) return fail();

  // ---- Every blocker is clear: all values below are present and valid. ----
  const m = movement!;
  const o = origin!;
  const payload: EwayBillGeneratePayload = {
    supplyType: 'O',
    subSupplyType: '1',
    docType: 'INV',
    docNo: documentNumber,
    docDate: ddmmyyyy(documentDateIso!),
    fromGstin: seller.gstin!.trim().toUpperCase(),
    fromTrdName: trimmed(seller.tradeName) ?? seller.legalName.trim(),
    fromAddr1: o.addr1!,
    ...(o.addr2 ? { fromAddr2: o.addr2 } : {}),
    fromPlace: o.place!,
    fromPincode: Number(o.pincode),
    actFromStateCode: Number(o.stateCode),
    fromStateCode: Number(supplierState),
    toGstin: recipientGstin,
    toTrdName: billTo.name.trim(),
    toAddr1: trimmed(shipTo.addressLine1)!,
    ...(trimmed(shipTo.addressLine2) ? { toAddr2: trimmed(shipTo.addressLine2) } : {}),
    toPlace: trimmed(shipTo.city)!,
    toPincode: Number(shipTo.postalCode!.trim()),
    actToStateCode: Number(shipToStateCode),
    toStateCode: Number(billToStateCode),
    transactionType,
    totalValue: paiseToNumber(totalValue!),
    cgstValue: paiseToNumber(cgst),
    sgstValue: paiseToNumber(sgst),
    igstValue: paiseToNumber(igst),
    cessValue: 0,
    cessNonAdvolValue: 0,
    otherValue: paiseToNumber(other!),
    totInvValue: paiseToNumber(payable!),
    transMode: TRANSPORT_MODE_CODE[mode!],
    transDistance: String(m.approximateDistanceKm!),
    ...(transporterId ? { transporterId } : {}),
    ...(trimmed(m.transporterName) ? { transporterName: trimmed(m.transporterName) } : {}),
    ...(transDocNo ? { transDocNo } : {}),
    ...(m.transportDocumentDate ? { transDocDate: ddmmyyyy(m.transportDocumentDate) } : {}),
    // The vehicle fields describe road movement only (NIC: omit for rail / air / ship).
    ...(mode === 'ROAD' && vehicleNumber
      ? { vehicleNo: vehicleNumber, vehicleType: VEHICLE_TYPE_CODE[m.vehicleType!] }
      : {}),
    itemList: items,
  };

  return {
    ok: true,
    payload,
    fingerprint: fingerprintPayload(payload),
    document: { type: 'INV', number: documentNumber, date: documentDateIso! },
    classification: {
      transactionType,
      shipTo: arrangement!.shipTo,
      dispatchFrom: arrangement!.dispatchFrom,
    },
    warnings,
    assumptions: EWAY_BILL_REQUEST_ASSUMPTIONS,
    live,
  };
}
