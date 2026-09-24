import { describe, expect, it } from 'vitest';
import {
  EXPECTED_MRP_WORKBOOK_HEADER,
  MrpWorkbookError,
  normalizeMrpCategory,
  normalizeMrpSeason,
  parseMrpWorkbookRow,
  parseMrpWorkbookRows,
  transposedBaseCodeDigits,
  validateMrpWorkbookHeader,
} from './mrp-workbook.js';

const HEADER: string[] = [...EXPECTED_MRP_WORKBOOK_HEADER];

function row(overrides: Partial<Record<string, unknown>> = {}): unknown[] {
  const defaults: Record<string, unknown> = {
    season: 'AW-25',
    heads: '#VALUE!',
    description: 'Hot WheelsT-shirt HS-013',
    ips: 'Hot Wheels',
    category: 'T-shirt HS-',
    licensor: 'Matel',
    factory: 'Clifton',
    basecode: 39042013,
    mrp: 799,
    exfactory: 166,
    factory2: 'Clifton',
    colour: 'HIGH RISK RED',
    season2: 'AW-25',
  };
  const merged = { ...defaults, ...overrides };
  return [
    merged.season,
    merged.heads,
    merged.description,
    merged.ips,
    merged.category,
    merged.licensor,
    merged.factory,
    merged.basecode,
    merged.mrp,
    merged.exfactory,
    merged.factory2,
    merged.colour,
    merged.season2,
  ];
}

describe('validateMrpWorkbookHeader', () => {
  it('accepts the expected header', () => {
    expect(validateMrpWorkbookHeader(HEADER)).toEqual({ valid: true, reason: null });
  });

  it('rejects a header with a renamed column', () => {
    const bad = [...HEADER];
    bad[8] = 'Retail Price';
    const result = validateMrpWorkbookHeader(bad);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('MRP');
  });

  it('rejects a header with too few columns', () => {
    expect(validateMrpWorkbookHeader(HEADER.slice(0, 5))).toEqual({
      valid: false,
      reason: 'Expected 13 columns, found 5',
    });
  });
});

describe('normalizeMrpSeason', () => {
  it('strips hyphens/spaces and uppercases', () => {
    expect(normalizeMrpSeason('AW-25')).toBe('AW25');
    expect(normalizeMrpSeason('SS-26')).toBe('SS26');
    expect(normalizeMrpSeason('ss 26')).toBe('SS26');
  });

  it('returns null for blank input', () => {
    expect(normalizeMrpSeason(null)).toBeNull();
    expect(normalizeMrpSeason('')).toBeNull();
  });
});

describe('transposedBaseCodeDigits', () => {
  it('swaps the 4th and 5th digit of an 8-digit code', () => {
    // Verified against the real workbook: AW25 Base code 39042013 <-> the
    // already-approved historical LMIX digits 39024013.
    expect(transposedBaseCodeDigits('39042013')).toBe('39024013');
    expect(transposedBaseCodeDigits('26042008')).toBe('26024008');
  });

  it('is its own inverse', () => {
    const once = transposedBaseCodeDigits('39042013')!;
    expect(transposedBaseCodeDigits(once)).toBe('39042013');
  });

  it('returns null for a non-8-digit code', () => {
    expect(transposedBaseCodeDigits('5526011')).toBeNull();
    expect(transposedBaseCodeDigits('123')).toBeNull();
  });
});

describe('parseMrpWorkbookRow', () => {
  it('parses a clean row with no issues', () => {
    const parsed = parseMrpWorkbookRow(row(), 2);
    expect(parsed).toMatchObject({
      excelRow: 2,
      season: 'AW25',
      seasonRaw: 'AW-25',
      baseCodeDigits: '39042013',
      mrp: 799,
      exFactoryCost: 166,
      colour: 'HIGH RISK RED',
      ipName: 'Hot Wheels',
      licensor: 'Matel',
      issues: [],
    });
  });

  it('flags a blank MRP', () => {
    const parsed = parseMrpWorkbookRow(row({ mrp: null }), 5);
    expect(parsed.mrp).toBeNull();
    expect(parsed.issues).toEqual([{ code: 'BLANK_MRP', detail: 'MRP column is blank' }]);
  });

  it('flags a malformed (non-numeric) MRP without inventing a fallback', () => {
    const parsed = parseMrpWorkbookRow(row({ mrp: 'TBD' }), 5);
    expect(parsed.mrp).toBeNull();
    expect(parsed.issues).toEqual([{ code: 'MALFORMED_MRP', detail: 'MRP value "TBD" is not a valid positive number' }]);
  });

  it('flags a zero or negative MRP as malformed, never treats it as valid', () => {
    expect(parseMrpWorkbookRow(row({ mrp: 0 }), 5).mrp).toBeNull();
    expect(parseMrpWorkbookRow(row({ mrp: -100 }), 5).mrp).toBeNull();
  });

  it('flags a blank Exfactory value', () => {
    const parsed = parseMrpWorkbookRow(row({ exfactory: '' }), 5);
    expect(parsed.exFactoryCost).toBeNull();
    expect(parsed.issues).toEqual([{ code: 'BLANK_EXFACTORY', detail: 'Exfactory column is blank' }]);
  });

  it('flags a blank Base code', () => {
    const parsed = parseMrpWorkbookRow(row({ basecode: null }), 5);
    expect(parsed.baseCodeDigits).toBeNull();
    expect(parsed.issues).toEqual([{ code: 'BLANK_BASECODE', detail: 'Base code column is blank' }]);
  });

  it('flags disagreement between the duplicated Season columns (A vs M)', () => {
    const parsed = parseMrpWorkbookRow(row({ season2: 'SS-26' }), 5);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'SEASON_COLUMN_MISMATCH' }));
  });

  it('flags disagreement between the duplicated Factory columns (G vs K)', () => {
    const parsed = parseMrpWorkbookRow(row({ factory2: 'Greenway' }), 5);
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'FACTORY_COLUMN_MISMATCH' }));
  });
});

describe('parseMrpWorkbookRows', () => {
  it('parses all data rows and skips fully-blank rows', () => {
    const sheet = [HEADER, row(), Array(13).fill(null), row({ basecode: 26042008, colour: 'ESTATE BLUE' })];
    const rows = parseMrpWorkbookRows(sheet);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.excelRow).toBe(2);
    expect(rows[1]!.excelRow).toBe(4);
  });

  it('throws MrpWorkbookError for an empty sheet', () => {
    expect(() => parseMrpWorkbookRows([])).toThrow(MrpWorkbookError);
  });

  it('throws MrpWorkbookError for an unrecognized header layout', () => {
    const badHeader = [...HEADER];
    badHeader[0] = 'Collection';
    expect(() => parseMrpWorkbookRows([badHeader, row()])).toThrow(MrpWorkbookError);
  });
});

// H2B.2 Stage A: proven by exact reconstruction — for AW25, workbook
// Description = IP's + Category + last-3-digits(Base code) on 42/42 rows, so
// Category's trailing "-" is the concatenation separator left behind, not
// business data. Only ONE trailing separator hyphen is ever removed; internal
// hyphens ("Co-Ord Set") are untouched, and SS26 rows (already clean, no
// trailing "-" on any of the 50) must pass through unchanged.
describe('normalizeMrpCategory', () => {
  it.each([
    ['Sweat Shirt-', 'Sweat Shirt', true],
    ['Sweat Shirt -', 'Sweat Shirt', true],
    ['Girls Shorts- ', 'Girls Shorts', true],
    ['T-shirt HS-', 'T-shirt HS', true],
    ["Hoody's Pant-", "Hoody's Pant", true],
    ['Co-Ord Set', 'Co-Ord Set', false],
    ['Girls Co-Ord Set', 'Girls Co-Ord Set', false],
    ['Boys Shorts  ', 'Boys Shorts', false], // already-clean SS26-shaped value: whitespace trim only, no hyphen artifact
    ['Girls Regular T-Shirt', 'Girls Regular T-Shirt', false],
  ])('normalizes %s -> %s (applied=%s)', (raw, expectedNormalized, expectedApplied) => {
    const result = normalizeMrpCategory(raw);
    expect(result.categoryRaw).toBe(raw);
    expect(result.categoryNormalized).toBe(expectedNormalized);
    expect(result.normalizationApplied).toBe(expectedApplied);
  });

  it('returns null for a null/undefined raw category', () => {
    expect(normalizeMrpCategory(null)).toEqual({ categoryRaw: null, categoryNormalized: null, normalizationApplied: false });
    expect(normalizeMrpCategory(undefined)).toEqual({ categoryRaw: null, categoryNormalized: null, normalizationApplied: false });
  });

  it('is idempotent — normalizing an already-normalized value changes nothing further', () => {
    const first = normalizeMrpCategory('Sweat Shirt-');
    const second = normalizeMrpCategory(first.categoryNormalized);
    expect(second.categoryNormalized).toBe('Sweat Shirt');
    expect(second.normalizationApplied).toBe(false);
  });
});
