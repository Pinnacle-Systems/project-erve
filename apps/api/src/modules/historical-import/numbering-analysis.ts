// Full-archive legacy-numbering analysis (H1 plan §8/§14). Scans every
// source record's legacyReferenceNumber — independent of any DB state —
// and reports ranges, gaps, malformed values, and repeats per season, so
// H1's final report can recommend the real historic identity rule (H1
// plan §15) from evidence rather than assuming it upfront.
export interface NumberingAnalysisInput {
  sourceFileName: string;
  sourceSeasonFolder: 'AW25' | 'SS26';
  legacyReferenceNumber: string | null;
}

/** "EI" + exactly 5 digits — fits every observed AW25/SS26 reference (EI25001..EI25042, EI26001..EI26050). Anything else is reported as malformed, not silently coerced. */
const WELL_FORMED_PATTERN = /^EI(\d{2})(\d{3})$/;

export interface SeasonNumberingSummary {
  season: 'AW25' | 'SS26';
  totalSourceDocuments: number;
  wellFormedCount: number;
  malformedCount: number;
  malformedReferences: Array<{ sourceFileName: string; legacyReferenceNumber: string | null }>;
  minSerial: number | null;
  maxSerial: number | null;
  missingSerials: number[];
  repeatedReferences: Array<{ legacyReferenceNumber: string; sourceFileNames: string[] }>;
}

export interface NumberingAnalysisResult {
  bySeason: SeasonNumberingSummary[];
  /** A reference appearing under more than one season folder — a cross-season reuse, reported explicitly since a per-season-only identity rule would silently ignore it. */
  crossSeasonReuse: Array<{ legacyReferenceNumber: string; occurrences: Array<{ sourceFileName: string; season: string }> }>;
}

export function analyzeLegacyNumbering(records: NumberingAnalysisInput[]): NumberingAnalysisResult {
  const seasons: Array<'AW25' | 'SS26'> = ['AW25', 'SS26'];
  const bySeason: SeasonNumberingSummary[] = seasons.map((season) => {
    const seasonRecords = records.filter((r) => r.sourceSeasonFolder === season);
    const malformedReferences: SeasonNumberingSummary['malformedReferences'] = [];
    const serials: number[] = [];
    const byReference = new Map<string, string[]>();

    for (const record of seasonRecords) {
      const ref = record.legacyReferenceNumber;
      if (!ref) {
        malformedReferences.push({ sourceFileName: record.sourceFileName, legacyReferenceNumber: null });
        continue;
      }
      const match = WELL_FORMED_PATTERN.exec(ref);
      if (!match) {
        malformedReferences.push({ sourceFileName: record.sourceFileName, legacyReferenceNumber: ref });
        continue;
      }
      serials.push(Number.parseInt(match[2]!, 10));
      const list = byReference.get(ref) ?? [];
      list.push(record.sourceFileName);
      byReference.set(ref, list);
    }

    const minSerial = serials.length > 0 ? Math.min(...serials) : null;
    const maxSerial = serials.length > 0 ? Math.max(...serials) : null;
    const presentSerials = new Set(serials);
    const missingSerials: number[] = [];
    if (minSerial !== null && maxSerial !== null) {
      for (let serial = minSerial; serial <= maxSerial; serial++) {
        if (!presentSerials.has(serial)) missingSerials.push(serial);
      }
    }

    const repeatedReferences = [...byReference.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([legacyReferenceNumber, sourceFileNames]) => ({ legacyReferenceNumber, sourceFileNames }));

    return {
      season,
      totalSourceDocuments: seasonRecords.length,
      wellFormedCount: seasonRecords.length - malformedReferences.length,
      malformedCount: malformedReferences.length,
      malformedReferences,
      minSerial,
      maxSerial,
      missingSerials,
      repeatedReferences,
    };
  });

  const byReferenceAcrossSeasons = new Map<string, Array<{ sourceFileName: string; season: string }>>();
  for (const record of records) {
    if (!record.legacyReferenceNumber) continue;
    const list = byReferenceAcrossSeasons.get(record.legacyReferenceNumber) ?? [];
    list.push({ sourceFileName: record.sourceFileName, season: record.sourceSeasonFolder });
    byReferenceAcrossSeasons.set(record.legacyReferenceNumber, list);
  }
  const crossSeasonReuse = [...byReferenceAcrossSeasons.entries()]
    .filter(([, occurrences]) => new Set(occurrences.map((o) => o.season)).size > 1)
    .map(([legacyReferenceNumber, occurrences]) => ({ legacyReferenceNumber, occurrences }));

  return { bySeason, crossSeasonReuse };
}
