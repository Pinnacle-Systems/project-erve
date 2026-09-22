import { describe, expect, it } from 'vitest';
import { recommendIdentityRule } from './dry-run-report.service.js';
import { analyzeLegacyNumbering } from './numbering-analysis.js';

describe('recommendIdentityRule', () => {
  it('recommends legacyReferenceNumber alone when the archive is fully clean', () => {
    const numbering = analyzeLegacyNumbering([
      { sourceFileName: 'a.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25001' },
      { sourceFileName: 'b.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26001' },
    ]);
    const result = recommendIdentityRule(numbering);
    expect(result.recommendation).toBe('legacyReferenceNumber');
    expect(result.withinSeasonConflictsRequiringManualResolution).toEqual([]);
  });

  it('recommends legacyReferenceNumber alone (not the composite) for a WITHIN-season repeat, since adding Season would not resolve it — and reports it as a manual-resolution item', () => {
    const numbering = analyzeLegacyNumbering([
      { sourceFileName: 'EI26031.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26031' },
      { sourceFileName: 'EI26032.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26031' },
    ]);
    const result = recommendIdentityRule(numbering);
    expect(result.recommendation).toBe('legacyReferenceNumber');
    expect(result.withinSeasonConflictsRequiringManualResolution).toHaveLength(1);
    expect(result.withinSeasonConflictsRequiringManualResolution[0]).toMatchObject({ legacyReferenceNumber: 'EI26031', season: 'SS26' });
    expect(result.rationale).toContain('data-quality');
  });

  it('recommends the composite Season + legacyReferenceNumber only for genuine cross-season reuse', () => {
    const numbering = analyzeLegacyNumbering([
      { sourceFileName: 'a.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25099' },
      { sourceFileName: 'b.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI25099' },
    ]);
    const result = recommendIdentityRule(numbering);
    expect(result.recommendation).toBe('Season + legacyReferenceNumber');
  });
});
