import { describe, expect, it } from 'vitest';
import { Prisma } from '../../db/prisma.js';
import {
  aggregateHsnSummary,
  aggregateInvoiceTotals,
  calculateGrandTotal,
  calculatePayableRounding,
  classifyGstTreatment,
  computeLineTax,
  computeNormalUnitRate,
  resolveFinalUnitRate,
} from './tax-invoice-calculation.js';

const D = (value: string) => new Prisma.Decimal(value);

describe('Tax Invoice calculation — normal unit rate', () => {
  it('computes the exact scale-6 rate from the spec fixture', () => {
    const rate = computeNormalUnitRate(D('100.01'), D('66.67'));
    expect(rate.toString()).toBe('66.676667');
  });

  it('never rounds the intermediate rate', () => {
    const rate = computeNormalUnitRate(D('3000.00'), D('83.33'));
    // 3000 * 83.33 / 100 = 2499.9 exactly — confirm no spurious trailing digits either
    expect(rate.toString()).toBe('2499.9');
  });
});

describe('Tax Invoice calculation — final rate override', () => {
  it('uses the calculated rate when no override is present', () => {
    expect(resolveFinalUnitRate(D('66.676667'), null).toString()).toBe('66.676667');
    expect(resolveFinalUnitRate(D('66.676667'), undefined).toString()).toBe('66.676667');
  });

  it('uses the override rate, never blending with the calculated rate', () => {
    expect(resolveFinalUnitRate(D('66.676667'), D('2600')).toString()).toBe('2600');
  });
});

describe('Tax Invoice calculation — place of supply classification', () => {
  it('classifies same-state as INTRA', () => {
    expect(classifyGstTreatment('33', '33')).toBe('INTRA');
  });

  it('classifies different-state as INTER', () => {
    expect(classifyGstTreatment('33', '29')).toBe('INTER');
  });
});

describe('Tax Invoice calculation — line tax (spec fixture: rate 66.676667, qty 7, 18% intrastate)', () => {
  const finalUnitRate = D('66.676667');
  const quantity = 7;
  const gstPercent = D('18');

  it('computes the exact taxable value', () => {
    const result = computeLineTax(finalUnitRate, quantity, gstPercent, 'INTRA');
    expect(result.taxableValue.toString()).toBe('466.736669');
  });

  it('computes exact CGST/SGST split for an intrastate line, matching the spec fixture', () => {
    const result = computeLineTax(finalUnitRate, quantity, gstPercent, 'INTRA');
    expect(result.cgstAmount.toString()).toBe('42.00630021');
    expect(result.sgstAmount.toString()).toBe('42.00630021');
    expect(result.igstAmount.toString()).toBe('0');
    // CGST + SGST must reconstruct the undivided total tax exactly
    expect(result.cgstAmount.plus(result.sgstAmount).toString()).toBe('84.01260042');
  });

  it('computes exact IGST (no CGST/SGST) for an interstate line', () => {
    const result = computeLineTax(finalUnitRate, quantity, gstPercent, 'INTER');
    expect(result.igstAmount.toString()).toBe('84.01260042');
    expect(result.cgstAmount.toString()).toBe('0');
    expect(result.sgstAmount.toString()).toBe('0');
  });
});

describe('Tax Invoice calculation — fractional GST percentage (worst-case 11-decimal precision)', () => {
  it('preserves 11 decimal places when halving an odd-ending total tax', () => {
    // 1.000001 * 12.35 / 100 = 0.1235001235; split in half for CGST/SGST.
    const result = computeLineTax(D('1.000001'), 1, D('12.35'), 'INTRA');
    expect(result.taxableValue.toString()).toBe('1.000001');
    expect(result.cgstAmount.toString()).toBe('0.06175006175');
    expect(result.sgstAmount.toString()).toBe('0.06175006175');
  });
});

describe('Tax Invoice calculation — invoice aggregation and rounding', () => {
  it('sums line results without introducing rounding', () => {
    const lineA = computeLineTax(D('66.676667'), 7, D('18'), 'INTRA');
    const lineB = computeLineTax(D('1.000001'), 1, D('12.35'), 'INTRA');
    const totals = aggregateInvoiceTotals([lineA, lineB]);
    expect(totals.subtotal.toString()).toBe('467.73667');
    expect(totals.totalCgst.toString()).toBe('42.06805027175');
    expect(totals.totalSgst.toString()).toBe('42.06805027175');
    expect(totals.totalIgst.toString()).toBe('0');
    expect(totals.totalGst.toString()).toBe('84.1361005435');
  });

  it('rounds the grand total exactly once, with ROUND_HALF_UP, to 2 decimal places', () => {
    const grandTotal = calculateGrandTotal(D('467.73667'), D('84.1361005435'));
    // 467.73667 + 84.1361005435 = 551.8727705435 -> rounds to 551.87
    expect(grandTotal.toString()).toBe('551.87');
  });

  it('rounds half up at the boundary', () => {
    // .toFixed(2) is used here (not .toString()) because decimal.js does
    // not pad trailing zeros on toString() — 10.00 and 10 are the same
    // Decimal value, and Postgres' Decimal(14,2) column stores either
    // identically. toFixed(dp) is decimal.js's fixed-point guarantee.
    expect(calculateGrandTotal(D('10.005'), D('0')).toFixed(2)).toBe('10.01');
    expect(calculateGrandTotal(D('10.004'), D('0')).toFixed(2)).toBe('10.00');
  });
});

describe('Tax Invoice calculation — final payable round-off', () => {
  it.each([
    ['41952', '2097.60', '44049.60', '44050.00', '0.40'],
    ['10', '0.40', '10.40', '10.00', '-0.40'],
    ['10', '0', '10.00', '10.00', '0.00'],
    ['10', '0.50', '10.50', '11.00', '0.50'],
    ['10', '0.49999999999', '10.50', '10.00', '-0.50'],
    ['10', '0.50000000001', '10.50', '11.00', '0.50'],
    ['99999999999.49', '0.00999999999', '99999999999.50', '99999999999.00', '-0.50'],
    ['99999999999.49', '0.01000000001', '99999999999.50', '100000000000.00', '0.50'],
  ])(
    'rounds exact aggregate %s + %s without rounding components',
    (subtotal, gst, grand, payable, adjustment) => {
      const taxableValue = D(subtotal);
      const totalGst = D(gst);
      const grandTotal = calculateGrandTotal(taxableValue, totalGst);
      const result = calculatePayableRounding(taxableValue, totalGst, grandTotal);

      expect(grandTotal.toFixed(2)).toBe(grand);
      expect(result.payableTotal.toFixed(2)).toBe(payable);
      expect(result.roundOffAdjustment.toFixed(2)).toBe(adjustment);
      expect(result.roundingPolicy).toBe('NEAREST_RUPEE_HALF_UP_V1');
      expect(taxableValue.toString()).toBe(D(subtotal).toString());
      expect(totalGst.toString()).toBe(D(gst).toString());
    },
  );
});

describe('Tax Invoice calculation — HSN summary aggregation', () => {
  it('groups by HSN code and GST percent, summing taxable/tax amounts', () => {
    const lineA = {
      hsnCode: '61091000',
      gstPercent: D('5'),
      ...computeLineTax(D('100'), 10, D('5'), 'INTRA'),
    };
    const lineB = {
      hsnCode: '61091000',
      gstPercent: D('5'),
      ...computeLineTax(D('50'), 4, D('5'), 'INTRA'),
    };
    const lineC = {
      hsnCode: '62034200',
      gstPercent: D('18'),
      ...computeLineTax(D('3000'), 2, D('18'), 'INTER'),
    };

    const summary = aggregateHsnSummary([lineA, lineB, lineC]);
    expect(summary).toHaveLength(2);

    const garment5 = summary.find((row) => row.hsnCode === '61091000');
    expect(garment5?.taxableValue.toString()).toBe('1200');

    const garment18 = summary.find((row) => row.hsnCode === '62034200');
    expect(garment18?.igstAmount.toString()).toBe('1080');
  });
});
