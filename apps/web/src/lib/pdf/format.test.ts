import { describe, expect, it } from 'vitest';
import {
  formatPdfDate,
  formatPdfDateTime,
  formatPdfMoney,
  formatPdfNumber,
  formatPdfValue,
} from './format.js';

describe('formatPdfValue', () => {
  it('formats null/undefined/empty string as the em dash', () => {
    expect(formatPdfValue(null)).toBe('—');
    expect(formatPdfValue(undefined)).toBe('—');
    expect(formatPdfValue('')).toBe('—');
    expect(formatPdfValue('   ')).toBe('—');
  });

  it('passes through non-empty strings and numbers', () => {
    expect(formatPdfValue('ACTIVE')).toBe('ACTIVE');
    expect(formatPdfValue(42)).toBe('42');
    expect(formatPdfValue(0)).toBe('0');
  });
});

describe('formatPdfDate / formatPdfDateTime', () => {
  it('formats a valid ISO date and falls back on null/invalid input', () => {
    expect(formatPdfDate('2026-09-12T10:15:00.000Z')).toMatch(/2026/);
    expect(formatPdfDate(null)).toBe('—');
    expect(formatPdfDate(undefined)).toBe('—');
    expect(formatPdfDate('not-a-date')).toBe('—');

    expect(formatPdfDateTime('2026-09-12T10:15:00.000Z')).toMatch(/2026/);
    expect(formatPdfDateTime(null)).toBe('—');
    expect(formatPdfDateTime('not-a-date')).toBe('—');
  });
});

describe('formatPdfNumber', () => {
  it('formats numbers with 2 decimals by default and falls back for null/NaN', () => {
    expect(formatPdfNumber(1234)).toBe('1234.00');
    expect(formatPdfNumber(1234.5)).toBe('1234.50');
    expect(formatPdfNumber(0)).toBe('0.00');
    expect(formatPdfNumber(null)).toBe('—');
    expect(formatPdfNumber(undefined)).toBe('—');
    expect(formatPdfNumber(Number.NaN)).toBe('—');
  });
});

describe('formatPdfMoney', () => {
  it('prefixes the ISO currency code (not a symbol) and preserves zero', () => {
    // Helvetica (a PDF base-14 font) has no "₹" glyph, so the printed document uses the ISO
    // code even for INR — unlike the app's on-screen `₹` convention.
    expect(formatPdfMoney(249.5, 'INR')).toBe('INR 249.50');
    expect(formatPdfMoney(0, 'INR')).toBe('INR 0.00');
  });

  it('prefixes other currencies with their code', () => {
    expect(formatPdfMoney(10, 'USD')).toBe('USD 10.00');
  });

  it('falls back to the em dash for null/undefined/NaN', () => {
    expect(formatPdfMoney(null, 'INR')).toBe('—');
    expect(formatPdfMoney(undefined, 'INR')).toBe('—');
    expect(formatPdfMoney(Number.NaN, 'INR')).toBe('—');
  });
});
