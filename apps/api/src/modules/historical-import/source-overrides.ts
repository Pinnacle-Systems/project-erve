// Controlled source-override artifact for reviewed historical source-data
// anomalies (H2A plan §7/§8). An override is NEVER applied to the immutable
// source-staging.json / source-manifest.json artifacts, and never silently
// adopted — only an entry whose sourceSha256 EXACTLY matches the actual
// source document's own checksum, and whose individual field override is
// explicitly marked APPROVED (by a human, not by this tooling), is ever
// applied. The pipeline is: immutable source-staging + reviewed
// source-overrides -> effective migration record. An entry with the wrong
// checksum is rejected outright (never partially trusted); an unapproved
// override can never make a record READY.
import type { FieldProvenance, ParsedField, ParsedPurchaseOrderRecord, ParseStatus } from './po-pdf-parser.types.js';

export type SourceOverrideStatus = 'APPROVED' | 'REVIEW_REQUIRED' | 'REJECTED';

export interface SourceOverrideFieldEntry {
  field: string;
  sourceValue: unknown;
  approvedValue: unknown;
  reason: string;
  evidence?: string;
  status: SourceOverrideStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
}

export interface SourceOverrideEntry {
  sourceFile: string;
  sourceSha256: string;
  overrides: SourceOverrideFieldEntry[];
}

export class SourceOverrideError extends Error {}

export function parseSourceOverridesArtifact(json: unknown): SourceOverrideEntry[] {
  if (!Array.isArray(json)) {
    throw new SourceOverrideError('source-overrides.json must be a JSON array of override entries');
  }
  return json as SourceOverrideEntry[];
}

/**
 * Returns only the APPROVED field overrides applicable to this exact source
 * document. Throws if an override entry names this source file but its
 * declared sourceSha256 does NOT match the document's actual checksum — a
 * stale/mismatched override must never be silently applied to a different
 * document than the one it was reviewed against.
 */
export function resolveApprovedOverridesForRecord(
  entries: SourceOverrideEntry[],
  record: { sourceFileName: string; sourceChecksumSha256: string },
): SourceOverrideFieldEntry[] {
  const matchingEntries = entries.filter((e) => e.sourceFile === record.sourceFileName);
  const approved: SourceOverrideFieldEntry[] = [];
  for (const entry of matchingEntries) {
    if (entry.sourceSha256 !== record.sourceChecksumSha256) {
      throw new SourceOverrideError(
        `Source override for "${record.sourceFileName}" declares sourceSha256 "${entry.sourceSha256}" but the ` +
          `actual source document hashes to "${record.sourceChecksumSha256}" — refusing to apply any override ` +
          'from this entry (wrong-checksum overrides are rejected outright, never partially trusted).',
      );
    }
    approved.push(...entry.overrides.filter((o) => o.status === 'APPROVED'));
  }
  return approved;
}

const STRING_FIELD_NAMES = new Set<keyof ParsedPurchaseOrderRecord>([
  'legacyReferenceNumber',
  'documentSeason',
  'factoryName',
  'licenseStyleLmix',
  'styleName',
  'colour',
  'description',
  'hsnCode',
  'orderDate',
  'shipmentDate',
  'unitRate',
  'currency',
  'paymentTerms',
  'approvalSampleInstructions',
  'aqlInspectionTerms',
]);

const OVERRIDE_PROVENANCE: FieldProvenance = 'OVERRIDE';

/**
 * Applies APPROVED overrides on top of a parsed record, returning a new
 * record — the input is never mutated, and this never touches
 * source-staging.json on disk. Each overridden field's provenance becomes
 * 'OVERRIDE' so downstream consumers can always tell an effective value
 * apart from one read verbatim off the source document. Only known
 * ParsedField<string> fields on the record can be overridden this way
 * (matches the current H2A use cases: legacyReferenceNumber, orderDate);
 * an override naming any other field is ignored with a returned warning
 * rather than silently applied to an unexpected shape.
 */
export function applyApprovedOverrides(
  parsed: ParsedPurchaseOrderRecord,
  approvedOverrides: SourceOverrideFieldEntry[],
): { record: ParsedPurchaseOrderRecord; appliedFields: string[]; ignoredFields: string[]; resolvedWarnings: string[] } {
  if (approvedOverrides.length === 0) return { record: parsed, appliedFields: [], ignoredFields: [], resolvedWarnings: [] };
  const next: ParsedPurchaseOrderRecord = { ...parsed };
  const appliedFields: string[] = [];
  const ignoredFields: string[] = [];
  for (const override of approvedOverrides) {
    const fieldName = override.field as keyof ParsedPurchaseOrderRecord;
    if (!STRING_FIELD_NAMES.has(fieldName)) {
      ignoredFields.push(override.field);
      continue;
    }
    const nextField: ParsedField<string> = { value: override.approvedValue as string, provenance: OVERRIDE_PROVENANCE };
    (next as unknown as Record<string, ParsedField<string>>)[fieldName] = nextField;
    appliedFields.push(override.field);
  }

  const { effectiveParseStatus, effectiveWarnings, resolvedWarnings } = recomputeEffectiveParseStatus(parsed, appliedFields);
  next.parseStatus = effectiveParseStatus;
  next.warnings = effectiveWarnings;

  return { record: next, appliedFields, ignoredFields, resolvedWarnings };
}

/** Explicit registry of which warning message(s) a given field's parser warnings use — deliberately NOT a blind substring/heuristic match, so this only ever recognizes the exact known warning shapes this parser produces (po-pdf-parser.ts), never guesses at an unrelated one. */
const FIELD_WARNING_PATTERNS: Partial<Record<keyof ParsedPurchaseOrderRecord, RegExp[]>> = {
  orderDate: [/^Could not extract required field: orderDate$/, /^Unrecognized order date format:/],
  shipmentDate: [/^Could not extract required field: shipmentDate$/, /^Unrecognized shipment date format:/],
  legacyReferenceNumber: [/^Could not extract required field: legacyReferenceNumber$/],
  documentSeason: [/^Could not extract required field: documentSeason$/],
  factoryName: [/^Could not extract required field: factoryName$/],
  licenseStyleLmix: [/^Could not extract required field: licenseStyleLmix$/],
  unitRate: [/^Could not extract required field: unitRate$/],
  headerTotalQuantity: [/^Could not extract required field: headerTotalQuantity$/],
};

/**
 * A record's parseStatus/warnings are set once, by the parser, from the RAW
 * (pre-override) field values — applying an approved override to e.g.
 * orderDate does not, by itself, change those. Without this step a record
 * would stay PARTIAL (and therefore REVIEW_REQUIRED downstream) "solely
 * because of" a field an approved override has already resolved, which is
 * exactly the outcome this story's approvals were meant to fix (H2A
 * continuation §4/§6). This recomputation is conservative: it only ever
 * downgrades PARTIAL -> OK (never touches FAILED — a whole-document parse
 * failure is never rescued by a single field override — and never
 * *introduces* a new problem), and only removes a warning when it exactly
 * matches a known pattern for a field that actually received an applied
 * override; every other warning (e.g. an unrelated quantity mismatch)
 * still counts and still keeps the record PARTIAL.
 */
export function recomputeEffectiveParseStatus(
  record: Pick<ParsedPurchaseOrderRecord, 'parseStatus' | 'warnings'>,
  appliedFields: string[],
): { effectiveParseStatus: ParseStatus; effectiveWarnings: string[]; resolvedWarnings: string[] } {
  if (record.parseStatus !== 'PARTIAL' || appliedFields.length === 0) {
    return { effectiveParseStatus: record.parseStatus, effectiveWarnings: record.warnings, resolvedWarnings: [] };
  }
  const applicablePatterns = appliedFields.flatMap((f) => FIELD_WARNING_PATTERNS[f as keyof ParsedPurchaseOrderRecord] ?? []);
  const resolvedWarnings: string[] = [];
  const effectiveWarnings = record.warnings.filter((w) => {
    const resolved = applicablePatterns.some((pattern) => pattern.test(w));
    if (resolved) resolvedWarnings.push(w);
    return !resolved;
  });
  const effectiveParseStatus: ParseStatus = effectiveWarnings.length === 0 ? 'OK' : 'PARTIAL';
  return { effectiveParseStatus, effectiveWarnings, resolvedWarnings };
}
