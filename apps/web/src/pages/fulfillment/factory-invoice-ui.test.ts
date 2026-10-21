import { describe, expect, it } from 'vitest';
import { formatMoney } from './factory-invoice-ui.js';

describe('Factory Invoice amount formatting', () => {
  it('preserves the existing currency sign and fixed two-decimal precision', () => {
    expect(formatMoney(0)).toBe('₹0.00');
    expect(formatMoney(999.99)).toBe('₹999.99');
    expect(formatMoney(-1500.5)).toBe('₹-1,500.50');
  });

  it('uses Indian digit grouping for larger amounts', () => {
    expect(formatMoney(1500)).toBe('₹1,500.00');
    expect(formatMoney(1234567.89)).toBe('₹12,34,567.89');
  });

  it('retains existing formatting for non-decimal or non-finite values', () => {
    expect(formatMoney(Number.NaN)).toBe('₹NaN');
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('₹Infinity');
  });
});
