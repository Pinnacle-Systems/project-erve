import { describe, expect, it } from 'vitest';
import {
  formatInvoiceMoney,
  formatInvoiceAdjustment,
  invoiceIssuedAmount,
} from './tax-invoice-ui.js';

describe('Tax Invoice presentation preserves backend decimal strings', () => {
  it('retains exact unit and tax precision without floating-point conversion', () => {
    expect(formatInvoiceMoney('66.676667')).toBe('₹66.676667');
    expect(formatInvoiceMoney('99999999999.49999999999')).toBe('₹99,99,99,99,999.49999999999');
    expect(formatInvoiceMoney('0')).toBe('₹0.00');
    expect(formatInvoiceMoney(null)).toBe('Unavailable');
  });
  it('distinguishes signed and zero adjustments from an unavailable legacy snapshot', () => {
    expect(formatInvoiceAdjustment('0.40')).toBe('+₹0.40');
    expect(formatInvoiceAdjustment('-0.50')).toBe('−₹0.50');
    expect(formatInvoiceAdjustment('0.00')).toBe('₹0.00');
    expect(formatInvoiceAdjustment(null)).toBe('Not snapshotted');
  });
  it('renders backend scientific decimal notation without rounding tiny GST values', () => {
    expect(formatInvoiceMoney('1e-7')).toBe('₹0.0000001');
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
