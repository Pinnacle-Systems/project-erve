import { describe, expect, it } from 'vitest';
import { formatPdfDate, formatPdfDateTime, formatPdfNumber, formatPdfValue } from './format.js';

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
