import { describe, expect, it } from 'vitest';
import { analyzeLegacyNumbering } from './numbering-analysis.js';

describe('analyzeLegacyNumbering', () => {
  it('reports the min/max/missing serials and repeated references per season', () => {
    const result = analyzeLegacyNumbering([
      { sourceFileName: 'a.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25001' },
      { sourceFileName: 'b.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25003' },
      { sourceFileName: 'c.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25003' },
      { sourceFileName: 'd.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26014' },
      { sourceFileName: 'e.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26016' },
    ]);
    const aw25 = result.bySeason.find((s) => s.season === 'AW25')!;
    expect(aw25.minSerial).toBe(1);
    expect(aw25.maxSerial).toBe(3);
    expect(aw25.missingSerials).toEqual([2]);
    expect(aw25.repeatedReferences).toEqual([{ legacyReferenceNumber: 'EI25003', sourceFileNames: ['b.pdf', 'c.pdf'] }]);

    const ss26 = result.bySeason.find((s) => s.season === 'SS26')!;
    expect(ss26.missingSerials).toEqual([15]);
  });

  it('flags malformed/missing references without silently coercing them', () => {
    const result = analyzeLegacyNumbering([
      { sourceFileName: 'bad.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25' },
      { sourceFileName: 'missing.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: null },
    ]);
    const aw25 = result.bySeason.find((s) => s.season === 'AW25')!;
    expect(aw25.malformedCount).toBe(2);
    expect(aw25.wellFormedCount).toBe(0);
  });

  it('flags the same reference reused across two different season folders', () => {
    const result = analyzeLegacyNumbering([
      { sourceFileName: 'a.pdf', sourceSeasonFolder: 'AW25', legacyReferenceNumber: 'EI25099' },
      { sourceFileName: 'b.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI25099' },
    ]);
    expect(result.crossSeasonReuse).toHaveLength(1);
    expect(result.crossSeasonReuse[0]!.legacyReferenceNumber).toBe('EI25099');
  });

  it('H2A: the EI26031/EI26032 repeat disappears once the approved effective identity is used instead of the raw printed value', () => {
    // Before the approved override: both documents' PARSED legacyReferenceNumber read "EI26031" (the printed-number anomaly).
    const before = analyzeLegacyNumbering([
      { sourceFileName: 'EI26031.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26031' },
      { sourceFileName: 'EI26032.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26031' },
    ]);
    const beforeSs26 = before.bySeason.find((s) => s.season === 'SS26')!;
    expect(beforeSs26.repeatedReferences).toEqual([{ legacyReferenceNumber: 'EI26031', sourceFileNames: ['EI26031.pdf', 'EI26032.pdf'] }]);

    // After applying the APPROVED override (effective legacyReferenceNumber for EI26032.pdf becomes "EI26032"): no repeat remains.
    const after = analyzeLegacyNumbering([
      { sourceFileName: 'EI26031.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26031' },
      { sourceFileName: 'EI26032.pdf', sourceSeasonFolder: 'SS26', legacyReferenceNumber: 'EI26032' },
    ]);
    const afterSs26 = after.bySeason.find((s) => s.season === 'SS26')!;
    expect(afterSs26.repeatedReferences).toEqual([]);
    expect(afterSs26.missingSerials).not.toContain(32);
  });
});
