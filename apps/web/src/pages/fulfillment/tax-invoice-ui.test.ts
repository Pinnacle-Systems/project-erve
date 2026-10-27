import { describe, expect, it } from 'vitest';
import {
  formatInvoiceMoney,
  formatInvoiceAdjustment,
  invoiceIssuedAmount,
} from './tax-invoice-ui.js';

describe('Tax Invoice presentation preserves backend decimal strings', () => {
  it('rounds high-precision backend amounts to exactly two decimals, decimal-safe', () => {
    expect(formatInvoiceMoney('66.676667')).toBe('₹66.68');
    expect(formatInvoiceMoney('99999999999.49999999999')).toBe('₹99,99,99,99,999.50');
    expect(formatInvoiceMoney('0')).toBe('₹0.00');
    expect(formatInvoiceMoney(null)).toBe('Unavailable');
  });
  it('rounds half-up on the third decimal without floating-point error', () => {
    expect(formatInvoiceMoney('857.205')).toBe('₹857.21');
    expect(formatInvoiceMoney('380.163')).toBe('₹380.16');
    expect(formatInvoiceMoney('477.042')).toBe('₹477.04');
    expect(formatInvoiceMoney('9.995')).toBe('₹10.00');
    expect(formatInvoiceMoney('-9.995')).toBe('−₹10.00');
  });
  it('preserves trailing zeros to exactly two decimals', () => {
    expect(formatInvoiceMoney('5')).toBe('₹5.00');
    expect(formatInvoiceMoney('5.1')).toBe('₹5.10');
    expect(formatInvoiceMoney('5.10')).toBe('₹5.10');
  });
  it('distinguishes signed and zero adjustments from an unavailable legacy snapshot', () => {
    expect(formatInvoiceAdjustment('0.40')).toBe('+₹0.40');
    expect(formatInvoiceAdjustment('-0.50')).toBe('−₹0.50');
    expect(formatInvoiceAdjustment('0.00')).toBe('₹0.00');
    expect(formatInvoiceAdjustment(null)).toBe('Not snapshotted');
  });
  it('does not present invalid adjustment amounts as signed currency', () => {
    expect(formatInvoiceAdjustment('invalid1')).toBe('Unavailable');
    expect(formatInvoiceAdjustment('1e-999')).toBe('Unavailable');
    expect(formatInvoiceAdjustment('1.25')).toBe('+₹1.25');
  });
  it('renders backend scientific decimal notation rounded to two decimals', () => {
    expect(formatInvoiceMoney('1e-7')).toBe('₹0.00');
    expect(formatInvoiceMoney('-1.25e+8')).toBe('−₹12,50,00,000.00');
  });
  it('uses the original issued amount for legacy documents without inventing payable rounding', () => {
    expect(invoiceIssuedAmount({ grandTotal: '44049.60', payableTotal: null })).toEqual({
      amount: '44049.60',
      label: 'Original issued total',
    });
    expect(invoiceIssuedAmount({ grandTotal: '44049.60', payableTotal: '44050.00' })).toEqual({
      amount: '44050.00',
      label: 'Final payable',
    });
  });
});
