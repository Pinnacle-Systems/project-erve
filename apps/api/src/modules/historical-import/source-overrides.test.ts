import { describe, expect, it } from 'vitest';
import { sourceField, unknownField, type ParsedPurchaseOrderRecord } from './po-pdf-parser.types.js';
import {
  applyApprovedOverrides,
  parseSourceOverridesArtifact,
  resolveApprovedOverridesForRecord,
  SourceOverrideError,
  type SourceOverrideEntry,
} from './source-overrides.js';

const RECORD_SHA = 'a'.repeat(64);

function baseParsedRecord(overrides?: Partial<ParsedPurchaseOrderRecord>): ParsedPurchaseOrderRecord {
  return {
    sourceFileName: 'EI26032.pdf',
    sourceRelativePath: 'EI26032.pdf',
    sourceChecksumSha256: RECORD_SHA,
    sourceSizeBytes: 1000,
    sourceSeasonFolder: 'SS26',
    parseStatus: 'OK',
    warnings: [],
    legacyReferenceNumber: sourceField('EI26031'),
    documentSeason: sourceField('SS26'),
    seasonFolderMismatch: false,
    factoryName: sourceField('Clifton Export Pvt Ltd'),
    licenseStyleLmix: sourceField('LMIX25426009'),
    styleName: sourceField('Minion Boys Regular T-Shirt'),
    colour: sourceField('12-0642 TCX Aurora'),
    description: sourceField('Boys Regular T-Shirt'),
    hsnCode: unknownField(),
    orderDate: sourceField('2026-02-25'),
    shipmentDate: sourceField('2026-03-30'),
    unitRate: sourceField('188'),
    currency: sourceField('INR'),
    paymentTerms: sourceField('30 days from dispatch'),
    approvalSampleInstructions: unknownField(),
    aqlInspectionTerms: unknownField(),
    sizeQuantities: [{ sizeCode: '3', quantity: 168 }],
    tableTotalQuantity: sourceField(1008),
    headerTotalQuantity: sourceField(1008),
    quantitySumMatchesTotal: true,
    ...overrides,
  };
}

describe('resolveApprovedOverridesForRecord', () => {
  it('returns only APPROVED overrides for a matching sourceSha256', () => {
    const entries: SourceOverrideEntry[] = [
      {
        sourceFile: 'EI26032.pdf',
        sourceSha256: RECORD_SHA,
        overrides: [
          { field: 'legacyReferenceNumber', sourceValue: 'EI26031', approvedValue: 'EI26032', reason: 'typo', status: 'APPROVED' },
          { field: 'orderDate', sourceValue: null, approvedValue: '2026-02-19', reason: 'inferred', status: 'REVIEW_REQUIRED' },
        ],
      },
    ];
    const resolved = resolveApprovedOverridesForRecord(entries, { sourceFileName: 'EI26032.pdf', sourceChecksumSha256: RECORD_SHA });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ field: 'legacyReferenceNumber', approvedValue: 'EI26032' });
  });

  it('rejects (throws) an override entry whose declared sourceSha256 does not match the actual document', () => {
    const entries: SourceOverrideEntry[] = [
      {
        sourceFile: 'EI26032.pdf',
        sourceSha256: 'WRONG_HASH'.padEnd(64, '0'),
        overrides: [{ field: 'legacyReferenceNumber', sourceValue: 'EI26031', approvedValue: 'EI26032', reason: 'typo', status: 'APPROVED' }],
      },
    ];
    expect(() =>
      resolveApprovedOverridesForRecord(entries, { sourceFileName: 'EI26032.pdf', sourceChecksumSha256: RECORD_SHA }),
    ).toThrow(SourceOverrideError);
  });

  it('returns an empty array when no override entry names this file', () => {
    expect(resolveApprovedOverridesForRecord([], { sourceFileName: 'EI26032.pdf', sourceChecksumSha256: RECORD_SHA })).toEqual([]);
  });

  it('an unapproved (REVIEW_REQUIRED) override never resolves, even with a matching hash', () => {
    const entries: SourceOverrideEntry[] = [
      {
        sourceFile: 'EI26032.pdf',
        sourceSha256: RECORD_SHA,
        overrides: [{ field: 'legacyReferenceNumber', sourceValue: 'EI26031', approvedValue: 'EI26032', reason: 'typo', status: 'REVIEW_REQUIRED' }],
      },
    ];
    expect(resolveApprovedOverridesForRecord(entries, { sourceFileName: 'EI26032.pdf', sourceChecksumSha256: RECORD_SHA })).toEqual([]);
  });
});

describe('applyApprovedOverrides', () => {
  it('replaces the field value and marks its provenance OVERRIDE, without mutating the input', () => {
    const parsed = baseParsedRecord();
    const { record, appliedFields } = applyApprovedOverrides(parsed, [
      { field: 'legacyReferenceNumber', sourceValue: 'EI26031', approvedValue: 'EI26032', reason: 'typo', status: 'APPROVED' },
    ]);
    expect(appliedFields).toEqual(['legacyReferenceNumber']);
    expect(record.legacyReferenceNumber).toEqual({ value: 'EI26032', provenance: 'OVERRIDE' });
    // The original source value is preserved on the untouched input record — never erased.
    expect(parsed.legacyReferenceNumber).toEqual({ value: 'EI26031', provenance: 'SOURCE_DOCUMENT' });
  });

  it('no-ops cleanly when there are no approved overrides', () => {
    const parsed = baseParsedRecord();
    const { record, appliedFields } = applyApprovedOverrides(parsed, []);
    expect(appliedFields).toEqual([]);
    expect(record).toBe(parsed);
  });

  it('ignores an override naming an unsupported field rather than applying it blindly', () => {
    const parsed = baseParsedRecord();
    const { record, appliedFields, ignoredFields } = applyApprovedOverrides(parsed, [
      { field: 'sizeQuantities', sourceValue: null, approvedValue: 'nonsense', reason: 'n/a', status: 'APPROVED' },
    ]);
    expect(appliedFields).toEqual([]);
    expect(ignoredFields).toEqual(['sizeQuantities']);
    expect(record.sizeQuantities).toEqual(parsed.sizeQuantities);
  });
});

describe('parseSourceOverridesArtifact', () => {
  it('accepts a well-formed array', () => {
    const entries: SourceOverrideEntry[] = [{ sourceFile: 'a.pdf', sourceSha256: RECORD_SHA, overrides: [] }];
    expect(parseSourceOverridesArtifact(entries)).toEqual(entries);
  });

  it('rejects a non-array payload', () => {
    expect(() => parseSourceOverridesArtifact({ not: 'an array' })).toThrow();
  });
});
