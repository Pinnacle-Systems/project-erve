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
  it('concatenates Season serial + LMIX digits + size number as strings', () => {
    expect(generateStyleSizeBarcode(source)).toEqual({ ok: true, barcode: '312343' });
    expect(generateStyleSizeBarcode({ ...source, sizeLabel: '10Y' })).toEqual({ ok: true, barcode: '3123410' });
  });

  it('accepts the plain numeric labels the Size master actually uses', () => {
    expect(generateStyleSizeBarcode({ ...source, sizeLabel: '3' })).toEqual({ ok: true, barcode: '312343' });
    expect(generateStyleSizeBarcode({ ...source, sizeLabel: '14' })).toEqual({ ok: true, barcode: '3123414' });
  });

  it('is string concatenation, not arithmetic: no sum and no loss of the LMIX digits', () => {
    // 3 + 1234 + 3 would be 1240 if the parts were added.
    const result = generateStyleSizeBarcode(source);
    expect(result).toEqual({ ok: true, barcode: '312343' });
    // Leading zeros inside the LMIX digits survive (a number round-trip would drop them).
    expect(generateStyleSizeBarcode({ ...source, lmixNumber: 'LMIX0042' })).toEqual({ ok: true, barcode: '300423' });
  });

  it('is deterministic and ignores LMIX case/whitespace', () => {
    expect(generateStyleSizeBarcode({ ...source, lmixNumber: ' lmix1234 ' })).toEqual({ ok: true, barcode: '312343' });
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

  it('allows historical alphanumeric formats but not spaces or over-long values', () => {
    expect(SUPPLIED_BARCODE_PATTERN.test('BJGGR26042008-3Y')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('312343')).toBe(true);
    expect(SUPPLIED_BARCODE_PATTERN.test('31 2343')).toBe(false);
    expect(SUPPLIED_BARCODE_PATTERN.test('1'.repeat(65))).toBe(false);
  });
});
