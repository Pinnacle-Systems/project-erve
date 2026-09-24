import { describe, expect, it } from 'vitest';
import { indexHsnRefreshBySourceChecksum, type HsnRefreshEntry } from './hsn-refresh.js';

function entry(overrides: Partial<HsnRefreshEntry>): HsnRefreshEntry {
  return {
    sourceChecksumSha256: 'a'.repeat(64),
    legacyReferenceNumber: 'EI99001',
    sourceSeasonFolder: 'SS26',
    sourceFileName: 'PO Sheet - EI99001.pdf',
    hsnCode: '61091000',
    parseStatus: 'OK',
    ...overrides,
  };
}

// H2B.2 Stage A: EI26032.pdf's raw printed order number is the typo'd
// "EI26031" (a real, H2A-investigated source defect) — two distinct
// documents can share one printed legacyReferenceNumber. Indexing by
// sourceChecksumSha256 instead keeps them from colliding onto one entry.
describe('indexHsnRefreshBySourceChecksum', () => {
  it('indexes distinct source PDFs independently even when they share a printed legacyReferenceNumber', () => {
    const entries = [
      entry({ sourceChecksumSha256: 'a'.repeat(64), legacyReferenceNumber: 'EI26031', hsnCode: '61142000' }),
      entry({ sourceChecksumSha256: 'b'.repeat(64), legacyReferenceNumber: 'EI26031', hsnCode: '61091000' }),
    ];
    const map = indexHsnRefreshBySourceChecksum(entries);
    expect(map.get('a'.repeat(64))).toBe('61142000');
    expect(map.get('b'.repeat(64))).toBe('61091000');
  });

  it('throws rather than silently picking one when the same checksum appears twice', () => {
    const entries = [entry({}), entry({})];
    expect(() => indexHsnRefreshBySourceChecksum(entries)).toThrow(/Duplicate source PDF checksum/);
  });

  it('carries a null hsnCode through unchanged', () => {
    const map = indexHsnRefreshBySourceChecksum([entry({ hsnCode: null })]);
    expect(map.get('a'.repeat(64))).toBeNull();
  });
});
