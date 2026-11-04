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
// snapshot and the captured E-Way-Bill movement; nothing is defaulted,
// guessed or invented. Where a value cannot be derived the result is a
// blocker (fail closed) naming the exact missing field or decision.
//
// Confirmed business decisions applied here:
//  - Every line is invoiced in pieces: UQC "PCS".
//  - OUTRIGHT and SALE_RETURN are BOTH outward sales (supplyType O, sub-supply
//    1 "Supply", docType INV). SALE_RETURN is ERVE's commercial purchase-mode
//    term, never a statutory sales-return movement, so purchaseMode is
//    deliberately NOT read when classifying (a test pins this).
//  - transactionType follows the actual bill-to / ship-to / dispatch-from
//    arrangement, never the purchase mode.
//
// The B1 readiness evaluator is reused for every check it already owns, so the
// two cannot drift apart; this module only adds what request-building needs.
// ---------------------------------------------------------------------------

const UQC_PIECES = 'PCS';
const HSN_DIGITS = /^\d{4,8}$/;
const DOCUMENT_AGE_WARNING_DAYS = 180;
/** Tolerated difference between rounded and exact aggregates, in paise. */
const ROUNDING_TOLERANCE_PAISE = 1n;
/** Tolerated difference between derived otherValue and the stored round-off, in paise. */
const ROUND_OFF_TOLERANCE_PAISE = 2n;

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
}

export interface EwayBillRequestClassification {
  transactionType: 1 | 2 | 3 | 4;
  shipToDiffersFromBillTo: boolean;
  dispatchFromDiffersFromSupplier: boolean;
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
    }
  | {
      ok: false;
      blockers: EwayBillBlocker[];
      warnings: EwayBillReason[];
      assumptions: readonly EwayBillUnverifiedRequirement[];
    };

/**
 * Mappings that ARE applied but could not be verified against NIC's own
 * documentation (docs.ewaybillgst.gov.in returns 403 to automated fetches).
 * Reported with every preparation so a reviewer sees them, never hidden.
 */
export const EWAY_BILL_REQUEST_ASSUMPTIONS: readonly EwayBillUnverifiedRequirement[] = [
  {
    code: 'OUTWARD_SALE_CODES',
    message: 'supplyType "O", subSupplyType "1" (Supply) and docType "INV" are used for every purchase mode.',
    basis: 'GSTINAPI generate example and the Vayana GSP v1.03 sample; NIC master-code page not retrievable.',
  },
  {
    code: 'TRANSACTION_TYPE_INFERRED_FROM_LOCATIONS',
    message:
      'The ship-to GSTIN is not captured, so "ship-to differs from bill-to" is inferred from the state and pincode of the two locations, and "dispatch-from differs from supplier" from the captured dispatch-from address.',
    basis: 'Data-model limit; transaction types 1-4 per ClearTax documentation.',
  },
  {
    code: 'WIRE_VALUE_TYPES',
    message: 'Pincodes, state codes, transactionType, hsnCode and quantity are sent as numbers; transMode, transDistance and vehicleType as strings.',
    basis: 'Vayana GSP v1.03 sample payload only.',
  },
  {
    code: 'VALUATION_BASIS',
    message:
      'totalValue is the sum of the 2-decimal-rounded line taxable values; totInvValue is the frozen payable total and otherValue the derived round-off.',
    basis: 'No source states which total NIC compares or its tolerance.',
  },
  {
    code: 'HSN_DIGIT_RANGE',
    message: 'HSN codes are required to be 4 to 8 digits.',
    basis: 'Third-party documentation (goods: 4, 6 or 8 digits); the 5- and 7-digit cases are not blocked here.',
  },
  {
    code: 'ROAD_VEHICLE_TYPE_REQUIRED',
    message: 'Road transport requires a vehicle number and a vehicle type; the type is never defaulted.',
    basis: 'Third-party documentation; vehicle-number format is not validated.',
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
  const { invoice, lines, movement } = facts;
  const now = (deps.now ?? (() => new Date()))();
  const warnings: EwayBillReason[] = [];

  // 1. Everything B1 already owns (status, document identity, party / item /
  //    movement data presence, mode-specific transport rules).
  const readiness = evaluateEwayBillReadiness(toReadinessFacts(facts), { now: () => now });
  const blockers: EwayBillBlocker[] = [...readiness.readiness.blockers];
  const fail = (): EwayBillRequestPreparation => ({
    ok: false,
    blockers,
    warnings,
    assumptions: EWAY_BILL_REQUEST_ASSUMPTIONS,
  });
  if (invoice.status !== 'FINALIZED') return fail();

  // 2. Document identity.
  const documentNumber = invoice.invoiceNumber?.trim() ?? '';
  const documentDateIso = invoice.finalizedAt ? isoDate(invoice.finalizedAt) : null;
  if (documentDateIso && documentNumber && DOCUMENT_NUMBER.test(documentNumber)) {
    const ageDays = Math.floor(
      (Date.parse(isoDate(now)) - Date.parse(documentDateIso)) / 86_400_000,
    );
    if (ageDays > DOCUMENT_AGE_WARNING_DAYS) {
      warnings.push({
        code: 'DOCUMENT_OLDER_THAN_180_DAYS',
        message: `The invoice is ${ageDays} days old; third-party documentation reports NIC refusing documents older than 180 days (not verified).`,
      });
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
  }
  if (origin && (!origin.addr1 || !origin.place)) {
    warnings.push({
      code: 'FROM_ADDRESS_PARTIAL',
      message: 'The dispatch-from address line or place is empty and is omitted from the request, not invented.',
    });
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
  const recipientGstin = billTo.gstin?.trim().toUpperCase() ?? '';
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
  if (!trimmed(shipTo.addressLine1) || !trimmed(shipTo.city)) {
    warnings.push({
      code: 'TO_ADDRESS_PARTIAL',
      message: 'The ship-to address line or place is empty and is omitted from the request, not invented.',
    });
  }

  // 5. Transaction type, from the actual arrangement (never the purchase mode).
  const shipToDiffersFromBillTo =
    shipToStateCode !== billToStateCode ||
    trimmed(shipTo.postalCode) !== trimmed(billTo.postalCode);
  const dispatchFromDiffersFromSupplier =
    origin !== null &&
    override !== null &&
    (origin.stateCode !== supplierState || origin.pincode !== trimmed(seller.postalCode));
  const transactionType: 1 | 2 | 3 | 4 = shipToDiffersFromBillTo
    ? dispatchFromDiffersFromSupplier
      ? 4
      : 2
    : dispatchFromDiffersFromSupplier
      ? 3
      : 1;

  // 6. Items.
  const itemPaise: bigint[] = [];
  const badHsn: string[] = [];
  const badQuantity: string[] = [];
  const badValue: string[] = [];
  const missingRate: string[] = [];
  const missingName: string[] = [];
  const items: EwayBillItemPayload[] = [];
  for (const line of lines) {
    const hsn = trimmed(line.hsnCode);
    if (hsn && !HSN_DIGITS.test(hsn)) badHsn.push(line.id);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) badQuantity.push(line.id);
    const paise = present(line.taxableValue) ? toPaiseHalfUp(line.taxableValue) : null;
    if (present(line.taxableValue) && (paise === null || paise < 0n)) badValue.push(line.id);
    const percent = present(line.gstPercent) ? Number(line.gstPercent) : Number.NaN;
    if (!Number.isFinite(percent) || percent < 0) missingRate.push(line.id);
    if (!trimmed(line.productName)) missingName.push(line.id);
    if (paise !== null && paise >= 0n) itemPaise.push(paise);

    const rate = Number.isFinite(percent) ? percent : 0;
    const half = Math.round((rate / 2) * 10_000) / 10_000;
    const isInter = invoice.gstTreatment === 'INTER';
    items.push({
      productName: trimmed(line.productName) ?? '',
      ...(trimmed(line.productDescription) ? { productDesc: trimmed(line.productDescription) } : {}),
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
  if (badHsn.length > 0) {
    blockers.push(blocker('ITEMS', 'items[].hsnCode', 'ITEM_HSN_FORMAT_INVALID', `${badHsn.length} line(s) have an HSN code that is not 4 to 8 digits.`, badHsn));
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

  // 8. Transport.
  const mode = movement?.transportMode ?? null;
  if (movement && mode === 'ROAD') {
    if (movement.vehicleType === null) {
      blockers.push(blocker('MOVEMENT', 'movement.vehicleType', 'MOVEMENT_VEHICLE_TYPE_REQUIRED', 'A vehicle type is required for road transport and is never defaulted.'));
    }
  }
  const transporterId = trimmed(movement?.transporterId)?.toUpperCase();
  if (transporterId && !isValidGstinFormat(transporterId)) {
    blockers.push(blocker('MOVEMENT', 'movement.transporterId', 'MOVEMENT_TRANSPORTER_ID_INVALID', 'The transporter ID is not a valid GSTIN.'));
  }

  if (blockers.length > 0) return fail();

  // ---- Every blocker is clear: all values below are present and valid. ----
  const m = movement!;
  const o = origin!;
  const vehicleNumber = trimmed(m.vehicleNumber)?.toUpperCase().replace(/[\s-]/g, '');
  const payload: EwayBillGeneratePayload = {
    supplyType: 'O',
    subSupplyType: '1',
    docType: 'INV',
    docNo: documentNumber,
    docDate: ddmmyyyy(documentDateIso!),
    fromGstin: seller.gstin!.trim().toUpperCase(),
    fromTrdName: trimmed(seller.tradeName) ?? seller.legalName.trim(),
    ...(o.addr1 ? { fromAddr1: o.addr1 } : {}),
    ...(o.addr2 ? { fromAddr2: o.addr2 } : {}),
    ...(o.place ? { fromPlace: o.place } : {}),
    fromPincode: Number(o.pincode),
    actFromStateCode: Number(o.stateCode),
    fromStateCode: Number(supplierState),
    toGstin: recipientGstin,
    toTrdName: billTo.name.trim(),
    ...(trimmed(shipTo.addressLine1) ? { toAddr1: trimmed(shipTo.addressLine1) } : {}),
    ...(trimmed(shipTo.addressLine2) ? { toAddr2: trimmed(shipTo.addressLine2) } : {}),
    ...(trimmed(shipTo.city) ? { toPlace: trimmed(shipTo.city) } : {}),
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
    ...(trimmed(m.transportDocumentNumber) ? { transDocNo: trimmed(m.transportDocumentNumber) } : {}),
    ...(m.transportDocumentDate ? { transDocDate: ddmmyyyy(m.transportDocumentDate) } : {}),
    // The vehicle fields describe road movement only.
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
    classification: { transactionType, shipToDiffersFromBillTo, dispatchFromDiffersFromSupplier },
    warnings,
    assumptions: EWAY_BILL_REQUEST_ASSUMPTIONS,
  };
}
