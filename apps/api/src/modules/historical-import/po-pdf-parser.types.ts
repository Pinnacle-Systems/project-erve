// Types for the AW25/SS26 historical PO-sheet parser (H1 plan §9/§21).
// FieldProvenance follows the spec's SOURCE_DOCUMENT/DERIVED/UNKNOWN
// classification: SOURCE_DOCUMENT = read verbatim off the PDF,
// DERIVED = computed from other source fields (e.g. a validation check),
// UNKNOWN = not confidently extracted — never silently inferred/guessed.
// OVERRIDE (added in H2A, see source-overrides.ts) = replaced by a reviewed,
// APPROVED source-override entry rather than read directly off the PDF —
// applied only in-memory to an effective record, never written back into
// the immutable source-staging.json.
export type FieldProvenance = 'SOURCE_DOCUMENT' | 'DERIVED' | 'UNKNOWN' | 'OVERRIDE';

export interface ParsedField<T> {
  value: T | null;
  provenance: FieldProvenance;
}

export function sourceField<T>(value: T | null): ParsedField<T> {
  return { value, provenance: value === null ? 'UNKNOWN' : 'SOURCE_DOCUMENT' };
}

export function unknownField<T>(): ParsedField<T> {
  return { value: null, provenance: 'UNKNOWN' };
}

export interface ParsedSizeQuantity {
  /** The raw column header text as printed, e.g. "3", "4", "M" — never assumed to be a fixed size set. */
  sizeCode: string;
  quantity: number | null;
}

export type ParseStatus = 'OK' | 'PARTIAL' | 'FAILED';

export interface ParsedPurchaseOrderRecord {
  sourceFileName: string;
  sourceRelativePath: string;
  sourceChecksumSha256: string;
  sourceSizeBytes: number;
  /** Which --aw25-dir/--ss26-dir flag supplied this file — compared against documentSeason for a mismatch check (H1 plan §16). */
  sourceSeasonFolder: 'AW25' | 'SS26';

  parseStatus: ParseStatus;
  warnings: string[];

  legacyReferenceNumber: ParsedField<string>;
  /** The Season value printed INSIDE the PDF (e.g. "AW25"), not the folder it came from. */
  documentSeason: ParsedField<string>;
  seasonFolderMismatch: boolean;
  factoryName: ParsedField<string>;
  licenseStyleLmix: ParsedField<string>;
  styleName: ParsedField<string>;
  colour: ParsedField<string>;
  description: ParsedField<string>;
  hsnCode: ParsedField<string>;
  orderDate: ParsedField<string>;
  shipmentDate: ParsedField<string>;
  unitRate: ParsedField<string>;
  currency: ParsedField<string>;
  paymentTerms: ParsedField<string>;
  approvalSampleInstructions: ParsedField<string>;
  aqlInspectionTerms: ParsedField<string>;

  sizeQuantities: ParsedSizeQuantity[];
  /** From the table's own "Total" column, e.g. "1008 Pcs" -> 1008. */
  tableTotalQuantity: ParsedField<number>;
  /** From the header grid's "Total qty" field — an independent cross-check of tableTotalQuantity. */
  headerTotalQuantity: ParsedField<number>;
  /** DERIVED: sum(sizeQuantities) === tableTotalQuantity (when both are known). Null if either side is unknown. */
  quantitySumMatchesTotal: boolean | null;
}
