// Explicit, reviewed historical source-Factory -> current Factory business-
// name mapping (H2A plan §10/§11). Loaded from a human-reviewed mapping
// artifact (factory-mapping.json). This is deliberately NOT a
// fuzzy/Levenshtein/contains matcher — every row is an exact source string
// mapped to an exact target Factory business name, both compared verbatim
// (after the same trim+lowercase normalization reconcileFactory already
// applies for its own exact match). A source string with no APPROVED row
// simply does not resolve via this mechanism; it falls through to
// UNMATCHED/BLOCKED like any other unresolved Factory, never guessed.
//
// This module is historical-import-specific. It must never be imported by,
// or used to weaken, ordinary Factory lookup anywhere else in ERVE.
export type FactoryMappingDecision = 'SAME_FACTORY' | 'DIFFERENT_FACTORY' | 'NEW_FACTORY_REQUIRED';
export type FactoryMappingStatus = 'APPROVED' | 'REVIEW_REQUIRED' | 'UNMAPPED';

export interface FactoryMappingRow {
  sourceFactoryName: string;
  normalizedSourceName?: string;
  targetFactoryName: string | null;
  targetFactoryCode?: string | null;
  targetDevFactoryId?: string | null;
  decision?: FactoryMappingDecision;
  rationale?: string;
  status: FactoryMappingStatus;
}

export interface FactoryMappingArtifact {
  mappings: FactoryMappingRow[];
}

export class FactoryMappingError extends Error {}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Returns the approved target Factory business name for an exact source
 * Factory string, or null if there is no APPROVED mapping row for it.
 * Exact-string match only (after trim+lowercase normalization) — never
 * fuzzy, never partial, never falls back to a REVIEW_REQUIRED/UNMAPPED row.
 */
export function resolveApprovedFactoryMapping(mappings: FactoryMappingRow[], sourceFactoryName: string): string | null {
  const normalizedSource = normalize(sourceFactoryName);
  const row = mappings.find((m) => normalize(m.sourceFactoryName) === normalizedSource);
  if (!row) return null;
  if (row.status !== 'APPROVED') return null;
  if (!row.targetFactoryName) return null;
  return row.targetFactoryName;
}

export function parseFactoryMappingArtifact(json: unknown): FactoryMappingRow[] {
  if (!json || typeof json !== 'object' || !Array.isArray((json as FactoryMappingArtifact).mappings)) {
    throw new FactoryMappingError('factory-mapping.json must be an object with a "mappings" array');
  }
  return (json as FactoryMappingArtifact).mappings;
}
