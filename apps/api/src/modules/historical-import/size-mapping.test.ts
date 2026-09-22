import { describe, expect, it } from 'vitest';
import { SizeMappingError, parseSizeMappingArtifact, resolveApprovedSizeMapping, verifySizeMappingAgainstLabels, type SizeMappingRow } from './size-mapping.js';

const mappings: SizeMappingRow[] = [
  { sourceSizeCode: '3', targetSizeCode: 'AGE_3', targetSizeLabel: '3', status: 'APPROVED' },
  { sourceSizeCode: '4', targetSizeCode: 'AGE_4', targetSizeLabel: '4', status: 'APPROVED' },
  { sourceSizeCode: 'XL', targetSizeCode: null, status: 'REVIEW_REQUIRED' },
  { sourceSizeCode: 'ZZ', targetSizeCode: null, status: 'UNMAPPED' },
];

describe('resolveApprovedSizeMapping', () => {
  it('resolves an APPROVED exact-string mapping to the stable Size.code', () => {
    expect(resolveApprovedSizeMapping(mappings, '3')).toBe('AGE_3');
    expect(resolveApprovedSizeMapping(mappings, '4')).toBe('AGE_4');
  });

  it('is trim-normalized but still exact-string, never fuzzy', () => {
    expect(resolveApprovedSizeMapping(mappings, '  3  ')).toBe('AGE_3');
    // A near-miss (leading zero) must NOT match.
    expect(resolveApprovedSizeMapping(mappings, '03')).toBeNull();
  });

  it('does not resolve a REVIEW_REQUIRED mapping row', () => {
    expect(resolveApprovedSizeMapping(mappings, 'XL')).toBeNull();
  });

  it('does not resolve an UNMAPPED row', () => {
    expect(resolveApprovedSizeMapping(mappings, 'ZZ')).toBeNull();
  });

  it('returns null for a source code with no mapping row at all', () => {
    expect(resolveApprovedSizeMapping(mappings, '99')).toBeNull();
  });
});

describe('verifySizeMappingAgainstLabels', () => {
  const currentSizes = [
    { id: 'id-3', code: 'AGE_3', label: '3' },
    { id: 'id-4', code: 'AGE_4', label: '4' },
    { id: 'id-dup-a', code: 'DUP_A', label: '7' },
    { id: 'id-dup-b', code: 'DUP_B', label: '7' },
  ];

  it('verifies and resolves when exactly one current Size has a matching label', () => {
    const result = verifySizeMappingAgainstLabels('3', currentSizes);
    expect(result).toEqual({ verified: true, targetSizeCode: 'AGE_3', targetDevSizeId: 'id-3' });
  });

  it('does not verify when no current Size has a matching label', () => {
    const result = verifySizeMappingAgainstLabels('XL', currentSizes);
    expect(result.verified).toBe(false);
  });

  it('does not verify (ambiguous) when more than one current Size shares the same label', () => {
    const result = verifySizeMappingAgainstLabels('7', currentSizes);
    expect(result.verified).toBe(false);
    if (!result.verified) expect(result.reason).toMatch(/ambiguous/i);
  });
});

describe('parseSizeMappingArtifact', () => {
  it('accepts a well-formed artifact', () => {
    expect(parseSizeMappingArtifact({ mappings })).toEqual(mappings);
  });

  it('rejects a malformed artifact', () => {
    expect(() => parseSizeMappingArtifact({ notMappings: [] })).toThrow(SizeMappingError);
    expect(() => parseSizeMappingArtifact(null)).toThrow(SizeMappingError);
  });
});
