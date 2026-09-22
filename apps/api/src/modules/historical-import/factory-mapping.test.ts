import { describe, expect, it } from 'vitest';
import { FactoryMappingError, parseFactoryMappingArtifact, resolveApprovedFactoryMapping, type FactoryMappingRow } from './factory-mapping.js';

const mappings: FactoryMappingRow[] = [
  { sourceFactoryName: 'Clifton export Pvt Ltd', targetFactoryName: 'Clifton', status: 'APPROVED' },
  { sourceFactoryName: 'MASS KNIT GARMENTS', targetFactoryName: 'Mass Knit', status: 'APPROVED' },
  { sourceFactoryName: 'Some New Vendor Ltd', targetFactoryName: null, status: 'REVIEW_REQUIRED' },
  { sourceFactoryName: 'Totally Unknown Supplier', targetFactoryName: null, status: 'UNMAPPED' },
];

describe('resolveApprovedFactoryMapping', () => {
  it('resolves an APPROVED exact-string mapping', () => {
    expect(resolveApprovedFactoryMapping(mappings, 'Clifton export Pvt Ltd')).toBe('Clifton');
  });

  it('is case/whitespace-normalized but still exact-string, never fuzzy', () => {
    expect(resolveApprovedFactoryMapping(mappings, '  clifton EXPORT pvt ltd  ')).toBe('Clifton');
    // A near-miss (missing a word) must NOT resolve, even though a human would recognize it.
    expect(resolveApprovedFactoryMapping(mappings, 'Clifton export')).toBeNull();
  });

  it('does not resolve a REVIEW_REQUIRED mapping row', () => {
    expect(resolveApprovedFactoryMapping(mappings, 'Some New Vendor Ltd')).toBeNull();
  });

  it('does not resolve an UNMAPPED row', () => {
    expect(resolveApprovedFactoryMapping(mappings, 'Totally Unknown Supplier')).toBeNull();
  });

  it('returns null for a source string with no mapping row at all', () => {
    expect(resolveApprovedFactoryMapping(mappings, 'Never Heard Of This Vendor')).toBeNull();
  });
});

describe('parseFactoryMappingArtifact', () => {
  it('accepts a well-formed artifact', () => {
    expect(parseFactoryMappingArtifact({ mappings })).toEqual(mappings);
  });

  it('rejects a malformed artifact', () => {
    expect(() => parseFactoryMappingArtifact({ notMappings: [] })).toThrow(FactoryMappingError);
    expect(() => parseFactoryMappingArtifact(null)).toThrow(FactoryMappingError);
  });
});
