// Explicit, reviewed historical source-Size-code -> current ERVE Size.code
// mapping (H2A continuation, analogous to factory-mapping.ts). Loaded from
// a human-reviewed mapping artifact (size-mapping.json). NOT a fuzzy/
// Levenshtein/contains matcher — every row is an exact source code string
// mapped to an exact target Size business key (Size.code), both compared
// verbatim (after the same trim normalization reconcileSizes already
// applies for its own exact match). A source code with no APPROVED row
// simply does not resolve via this mechanism; it falls through to
// UNMATCHED/BLOCKED like any other unresolved Size, never guessed.
//
// This module is historical-import-specific. It must never be imported by,
// or used to weaken, ordinary Size lookup anywhere else in ERVE. The
// portable artifact stores the stable Size.code business key — never a Dev
// database primary key — so the same mapping is meaningful across
// environments; a Dev Size id may appear only as diagnostic output.
export type SizeMappingDecision = 'SAME_SIZE' | 'DIFFERENT_SIZE' | 'NEW_SIZE_REQUIRED';
export type SizeMappingStatus = 'APPROVED' | 'REVIEW_REQUIRED' | 'UNMAPPED';

export interface SizeMappingRow {
  sourceSizeCode: string;
  /** The stable ERVE Size.code business key (never a Dev DB id) this source code resolves to, or null when UNMAPPED/REVIEW_REQUIRED. */
  targetSizeCode: string | null;
  /** The target Size's label, recorded for diagnostic verification only — this mapping's approval requires targetSizeLabel === sourceSizeCode (see verifySizeMappingAgainstLabels). */
  targetSizeLabel?: string | null;
  targetDevSizeId?: string | null;
  decision?: SizeMappingDecision;
  rationale?: string;
  status: SizeMappingStatus;
}

export interface SizeMappingArtifact {
  mappings: SizeMappingRow[];
}

export class SizeMappingError extends Error {}

function normalize(value: string): string {
  return value.trim();
}

/**
 * Returns the approved target Size.code for an exact source Size code, or
 * null if there is no APPROVED mapping row for it. Exact-string match only
 * (after trim normalization) — never fuzzy, never partial, never falls
 * back to a REVIEW_REQUIRED/UNMAPPED row.
 */
export function resolveApprovedSizeMapping(mappings: SizeMappingRow[], sourceSizeCode: string): string | null {
  const normalizedSource = normalize(sourceSizeCode);
  const row = mappings.find((m) => normalize(m.sourceSizeCode) === normalizedSource);
  if (!row) return null;
  if (row.status !== 'APPROVED') return null;
  if (!row.targetSizeCode) return null;
  return row.targetSizeCode;
}

export function parseSizeMappingArtifact(json: unknown): SizeMappingRow[] {
  if (!json || typeof json !== 'object' || !Array.isArray((json as SizeMappingArtifact).mappings)) {
    throw new SizeMappingError('size-mapping.json must be an object with a "mappings" array');
  }
  return (json as SizeMappingArtifact).mappings;
}

/**
 * Verification rule required before any row may be marked APPROVED (H2A
 * continuation §3): the proposed target Size, looked up by its current Dev
 * label, must be the SAME value as the source code being mapped, and there
 * must be EXACTLY ONE current Dev Size whose label matches — not zero
 * (nothing to map to), not more than one (ambiguous, could silently map to
 * the wrong one). Returns the single matching Size's code/id when the
 * mapping is verifiable, or a reason string explaining why it is not.
 */
export function verifySizeMappingAgainstLabels(
  sourceSizeCode: string,
  currentSizes: Array<{ code: string; label: string; id: string }>,
): { verified: true; targetSizeCode: string; targetDevSizeId: string } | { verified: false; reason: string } {
  const matches = currentSizes.filter((s) => s.label.trim() === sourceSizeCode.trim());
  if (matches.length === 0) {
    return { verified: false, reason: `No current Size has a label exactly equal to source code "${sourceSizeCode}"` };
  }
  if (matches.length > 1) {
    return { verified: false, reason: `${matches.length} current Sizes have a label exactly equal to source code "${sourceSizeCode}" — ambiguous, not auto-resolved` };
  }
  return { verified: true, targetSizeCode: matches[0]!.code, targetDevSizeId: matches[0]!.id };
}
