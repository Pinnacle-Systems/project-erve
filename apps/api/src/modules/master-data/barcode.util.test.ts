import { describe, expect, it } from 'vitest';
import {
  generateStyleSizeBarcode,
  normalizeSuppliedBarcode,
  parseLmixDigits,
  parseSizeNumber,
  SUPPLIED_BARCODE_PATTERN,
} from './barcode.util.js';

const source = { seasonSerial: 3, lmixNumber: 'LMIX1234', sizeLabel: '3Y', sizeType: 'AGE' };

describe('generateStyleSizeBarcode', () => {
  it('generates the Season 3+ barcode with one space and padded size ages', () => {
    const withBusinessLmix = { ...source, lmixNumber: 'LMIX12345678' };
    expect(generateStyleSizeBarcode(withBusinessLmix)).toEqual({ ok: true, barcode: '3 1234567803' });
    expect(generateStyleSizeBarcode({ ...withBusinessLmix, sizeLabel: '10Y' })).toEqual({ ok: true, barcode: '3 1234567810' });
    expect(generateStyleSizeBarcode({ ...source, seasonSerial: 4 })).toEqual({ ok: true, barcode: '4 123403' });
    expect(generateStyleSizeBarcode({ ...source, seasonSerial: 10 })).toEqual({ ok: true, barcode: '10 123403' });
  });

  it('preserves legacy generation for Season barcode serials 1 and 2', () => {
    expect(generateStyleSizeBarcode({ ...source, seasonSerial: 1 })).toEqual({ ok: true, barcode: '112343' });
    expect(generateStyleSizeBarcode({ ...source, seasonSerial: 2, sizeLabel: '10Y' })).toEqual({ ok: true, barcode: '2123410' });
  });

  it('accepts the plain numeric labels the Size master actually uses', () => {
    expect(generateStyleSizeBarcode({ ...source, sizeLabel: '3' })).toEqual({ ok: true, barcode: '3 123403' });
    expect(generateStyleSizeBarcode({ ...source, sizeLabel: '14' })).toEqual({ ok: true, barcode: '3 123414' });
  });

  it('is string concatenation, not arithmetic: no sum and no loss of the LMIX digits', () => {
    const result = generateStyleSizeBarcode(source);
    expect(result).toEqual({ ok: true, barcode: '3 123403' });
    // Leading zeros inside LMIX and the padded size survive: no numeric round-trip.
    expect(generateStyleSizeBarcode({ ...source, lmixNumber: 'LMIX0042' })).toEqual({ ok: true, barcode: '3 004203' });
  });

  it('is deterministic and ignores LMIX case/whitespace', () => {
    expect(generateStyleSizeBarcode({ ...source, lmixNumber: ' lmix1234 ' })).toEqual({ ok: true, barcode: '3 123403' });
  });

  it.each([null, undefined, 0, -1, 1.5])('rejects a missing/invalid Season serial (%s)', (seasonSerial) => {
    const result = generateStyleSizeBarcode({ ...source, seasonSerial });
    expect(result).toMatchObject({ ok: false, problem: 'MISSING_SEASON_SERIAL' });
  });

  it.each(['', '   ', null, undefined, '1234', 'LMIX', 'LMIX12A4', 'XLMIX1234', 'LMIX 1234', 'LMIX1234-2'])(
    'rejects malformed LMIX %j instead of salvaging digits from it',
    (lmixNumber) => {
      expect(generateStyleSizeBarcode({ ...source, lmixNumber })).toMatchObject({
        ok: false,
        problem: 'INVALID_LMIX',
      });
    },
  );

  it.each([
    ['3-8 YEARS', 'AGE'],
    ['S', 'ALPHA'],
    ['XL', 'ALPHA'],
    ['FREE', 'FREE_SIZE'],
    ['03', 'AGE'],
    ['0', 'AGE'],
    ['3Y4', 'AGE'],
    ['AGE 3', 'AGE'],
    ['', 'AGE'],
    ['32', 'WAIST'],
    ['3', 'ALPHA'],
  ])('reports ambiguous size %j (%s) rather than guessing', (sizeLabel, sizeType) => {
    expect(generateStyleSizeBarcode({ ...source, sizeLabel, sizeType })).toMatchObject({
      ok: false,
      problem: 'AMBIGUOUS_SIZE',
    });
  });
});

describe('parsers', () => {
  it('parses LMIX digits strictly', () => {
    expect(parseLmixDigits('LMIX39026006')).toBe('39026006');
    expect(parseLmixDigits('LMIX')).toBeNull();
    expect(parseLmixDigits(null)).toBeNull();
  });

  it('parses size numbers for AGE/NUMERIC sizes only', () => {
    expect(parseSizeNumber('3Y', 'AGE')).toBe('3');
    expect(parseSizeNumber('10 YRS', 'AGE')).toBe('10');
    expect(parseSizeNumber('10', 'NUMERIC')).toBe('10');
    expect(parseSizeNumber('10', 'WAIST')).toBeNull();
  });
});

describe('supplied barcodes', () => {
  it('treats blank as not supplied and otherwise preserves the value verbatim', () => {
    expect(normalizeSuppliedBarcode(undefined)).toBeNull();
    expect(normalizeSuppliedBarcode('   ')).toBeNull();
    expect(normalizeSuppliedBarcode('  BJGGR26042008-3Y ')).toBe('BJGGR26042008-3Y');
  });

  it('preserves historical values and permits only the exact new Season 3+ space format', () => {
    expect(SUPPLIED_BARCODE_PATTERN.test('BJGGR26042008-3Y')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('312343')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('3 1234567803')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('3 1234567810')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('10 1234567803')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('1 1234567803')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('3 12 34567803')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('3  ABC')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('3 12345678 03')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('has space')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('1'.repeat(65))).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('3 ' + '1'.repeat(63))).toBe(false);
  });
});
