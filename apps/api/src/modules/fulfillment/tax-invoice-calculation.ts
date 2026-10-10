import { Prisma } from '../../db/prisma.js';

// Pure, DB-free financial calculations for INV-006 (Tax Invoice calculation
// and finalization). Every function here operates on Prisma.Decimal and
// never touches a JS `number` for a monetary value — floating-point
// conversion is only safe at API-response serialization boundaries, never
// mid-calculation.
//
// Precision contract (verified against the approved Phase A/B precision
// model, not assumed):
//   finalUnitRate      = styleMrp(scale 2) * pct(scale 2) / 100       -> scale 6
//   taxableValue        = finalUnitRate(scale 6) * quantity(integer)  -> scale 6
//   totalLineTax        = taxableValue(scale 6) * gstPercent(scale 2) / 100 -> scale 10 (worst case)
//   cgst/sgst (intra)    = totalLineTax / 2                            -> scale 11 (worst case; halving
//                          an odd-ending decimal can need one more decimal place to stay exact)
// grandTotal retains ROUND_HALF_UP at 2dp. PR0 adds a separate final payable
// rounded directly from the exact aggregate to whole rupees. All line and
// GST components retain their exact, unrounded computed values.

export type GstTreatment = 'INTRA' | 'INTER';

/** normalUnitRate = frozenStyleMrp * frozenDistributorPricingPercentage / 100 */
export function computeNormalUnitRate(
  styleMrp: Prisma.Decimal,
  distributorPricingPercentage: Prisma.Decimal,
): Prisma.Decimal {
  return styleMrp.times(distributorPricingPercentage).dividedBy(100);
}

/** The override, when present, always wins — never averaged or blended with the calculated rate. */
export function resolveFinalUnitRate(
  calculatedUnitRate: Prisma.Decimal,
  overrideUnitRate: Prisma.Decimal | null | undefined,
): Prisma.Decimal {
  return overrideUnitRate ?? calculatedUnitRate;
}

/**
 * Place-of-supply GST treatment. Both inputs must already be validated,
 * canonical 2-digit GST state codes — this function performs no validation
 * and no state-name resolution itself (see gst-state-codes.ts).
 */
export function classifyGstTreatment(
  sellerStateCode: string,
  placeOfSupplyStateCode: string,
): GstTreatment {
  return sellerStateCode === placeOfSupplyStateCode ? 'INTRA' : 'INTER';
}

export interface LineTaxResult {
  taxableValue: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
}

/**
 * Computes one line's taxable value and CGST/SGST/IGST split. `quantity`
 * is an integer (Int column) and never contributes decimal scale.
 */
export function computeLineTax(
  finalUnitRate: Prisma.Decimal,
  quantity: number,
  gstPercent: Prisma.Decimal,
  treatment: GstTreatment,
): LineTaxResult {
  const taxableValue = finalUnitRate.times(quantity);
  const totalTax = taxableValue.times(gstPercent).dividedBy(100);
  const zero = new Prisma.Decimal(0);

  if (treatment === 'INTRA') {
    const half = totalTax.dividedBy(2);
    return { taxableValue, cgstAmount: half, sgstAmount: half, igstAmount: zero };
  }
  return { taxableValue, cgstAmount: zero, sgstAmount: zero, igstAmount: totalTax };
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal;
  totalCgst: Prisma.Decimal;
  totalSgst: Prisma.Decimal;
  totalIgst: Prisma.Decimal;
  totalGst: Prisma.Decimal;
}

/** Sums line-level results. Addition never increases scale beyond the operands', so this stays unrounded. */
export function aggregateInvoiceTotals(lines: readonly LineTaxResult[]): InvoiceTotals {
  const zero = new Prisma.Decimal(0);
  const subtotal = lines.reduce((sum, line) => sum.plus(line.taxableValue), zero);
  const totalCgst = lines.reduce((sum, line) => sum.plus(line.cgstAmount), zero);
  const totalSgst = lines.reduce((sum, line) => sum.plus(line.sgstAmount), zero);
  const totalIgst = lines.reduce((sum, line) => sum.plus(line.igstAmount), zero);
  return {
    subtotal,
    totalCgst,
    totalSgst,
    totalIgst,
    totalGst: totalCgst.plus(totalSgst).plus(totalIgst),
  };
}

/**
 * Preserves the existing subtotal + total GST rounding to 2 decimal places
 * using ROUND_HALF_UP. Line and tax components keep their full precision;
 * the separate payable policy below does not change this result.
 */
export function calculateGrandTotal(
  subtotal: Prisma.Decimal,
  totalGst: Prisma.Decimal,
): Prisma.Decimal {
  return subtotal.plus(totalGst).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// Stored aggregates use up to 31 significant digits. A local constructor
// leaves enough headroom for addition without changing INV-006's global
// Decimal settings or existing line, GST and grandTotal calculations.
const PayableDecimal = Prisma.Decimal.clone({ precision: 40 });

/**
 * PR0: round the exact aggregate once to whole rupees, never the already
 * rounded grandTotal (which would double-round just-below-half boundaries).
 * The signed adjustment reconciles the two persisted monetary totals;
 * it never changes the taxable value, GST components or HSN summary.
 */
export function calculatePayableRounding(
  subtotal: Prisma.Decimal,
  totalGst: Prisma.Decimal,
  grandTotal: Prisma.Decimal,
) {
  const payableTotal = new PayableDecimal(subtotal)
    .plus(totalGst)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return {
    payableTotal,
    roundOffAdjustment: payableTotal.minus(grandTotal),
    roundingPolicy: 'NEAREST_RUPEE_HALF_UP_V1' as const,
  };
}

export interface HsnSummaryInput {
  hsnCode: string;
  gstPercent: Prisma.Decimal;
  taxableValue: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
}

export interface HsnSummaryRow {
  hsnCode: string;
  gstPercent: Prisma.Decimal;
  taxableValue: Prisma.Decimal;
  cgstAmount: Prisma.Decimal;
  sgstAmount: Prisma.Decimal;
  igstAmount: Prisma.Decimal;
}

/**
 * Groups finalized line snapshots by (hsnCode, gstPercent) for the
 * statutory HSN-wise tax summary. Derived purely from the already-computed
 * line results — never re-resolves HSN/GST live, so a finalized invoice's
 * summary cannot drift if master data changes later.
 */
export function aggregateHsnSummary(lines: readonly HsnSummaryInput[]): HsnSummaryRow[] {
  const byKey = new Map<string, HsnSummaryRow>();
  for (const line of lines) {
    const key = `${line.hsnCode}::${line.gstPercent.toString()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.taxableValue = existing.taxableValue.plus(line.taxableValue);
      existing.cgstAmount = existing.cgstAmount.plus(line.cgstAmount);
      existing.sgstAmount = existing.sgstAmount.plus(line.sgstAmount);
      existing.igstAmount = existing.igstAmount.plus(line.igstAmount);
    } else {
      byKey.set(key, {
        hsnCode: line.hsnCode,
        gstPercent: line.gstPercent,
        taxableValue: line.taxableValue,
        cgstAmount: line.cgstAmount,
        sgstAmount: line.sgstAmount,
        igstAmount: line.igstAmount,
      });
    }
  }
  return [...byKey.values()];
}
