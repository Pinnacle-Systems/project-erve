// H2B.2 follow-up: historical Style.hsnDescription source policy ("Policy C"),
// approved from the 91-record audit at
// .artifacts/historical-import/AW25-SS26/h2b-hsn-description-audit/.
//
// The text a PO PDF prints after the numeric code on its "*HS" line (e.g.
// "*HS 61091000 Boys / T-Shirt") is a SOURCE-PROVIDED human-readable label,
// never an official GST/customs tariff description. It is kept verbatim
// (surrounding whitespace trimmed only — no spelling, case, or internal-space
// normalization) and only when the source block is internally consistent:
// the audit found PDFs whose *ST1/*HS stanza was copied from a different
// style (EI25011) and an HS label naming the wrong gender (EI25013).
//
// Pure logic, no I/O. Input is the H2B.1 documentary extraction already in
// staging (specificationText holds the *ST1 and *HS lines verbatim), so a
// fresh import and the Dev backfill share this one implementation.
// hsnCode itself is still owned by extractHsnCode (po-pdf-parser.ts); the
// code parsed here is only used as a cross-check against it.

/** optional "*", HS, optional spaces, optional "-", optional spaces, 6–8 digit code, then the trailing source text. */
export const HSN_SOURCE_LINE_PATTERN = /^\s*\*?\s*HS\s*-?\s*(\d{6,8})(?!\d)(.*)$/i;
/** A specification line that is an HS line at all ("HS" not followed by another letter, so e.g. "*HSN..." prose would not be mistaken for it). */
const HS_LINE_START = /^\s*\*?\s*HS(?![a-z])/i;
const ST1_LINE_START = /^\s*\*?\s*ST\s*1\b/i;
/** Wording that belongs to neighboring stanzas (another *ST marker, the commercial clauses) — its presence means the label is not clean source text. */
const SPILLOVER = /\*|\bST\s*\d|detailed trims|accessories|bill of material|penalt|any delay|\bAQL\b|delivery date|for all additional|\bPLM\b/i;
/** Longest real label in the 91-document audit is 24 characters; anything far longer is not a label. */
const MAX_DESCRIPTION_LENGTH = 60;

export interface ParsedHsnSourceLine {
  hsnCode: string;
  /** Everything after the numeric code, exactly as printed (null when nothing follows). */
  trailingTextRaw: string | null;
  /** trailingTextRaw with surrounding whitespace trimmed; null when empty. */
  candidateDescription: string | null;
}

export function parseHsnSourceLine(line: string): ParsedHsnSourceLine | null {
  const match = HSN_SOURCE_LINE_PATTERN.exec(line);
  if (!match) return null;
  const trailing = match[2]!;
  return {
    hsnCode: match[1]!,
    trailingTextRaw: trailing.length ? trailing : null,
    candidateDescription: trailing.trim() || null,
  };
}

export type HsnDescriptionClassification =
  | 'HSN_WITH_SOURCE_DESCRIPTION'
  | 'HSN_CODE_ONLY'
  | 'REVIEW_REQUIRED'
  | 'PARSE_ERROR'
  | 'NO_HS_LINE';

export type HsnSemanticCheck =
  | 'PASS'
  | 'NOT_APPLICABLE'
  | 'SOURCE_BLOCK_CONFLICT'
  | 'GENDER_CONFLICT'
  | 'PRODUCT_CONFLICT'
  | 'SPILLOVER'
  | 'HSN_CODE_MISMATCH';

export interface HsnDescriptionResolution {
  classification: HsnDescriptionClassification;
  semanticCheck: HsnSemanticCheck;
  rawHsLine: string | null;
  parsedHsnCode: string | null;
  candidateHsnDescription: string | null;
  /** The only value ever written to Style.hsnDescription — null unless classification is HSN_WITH_SOURCE_DESCRIPTION. */
  proposedHsnDescription: string | null;
  st1Text: string | null;
  /** True when the *ST1/*HS stanza contradicts the table: the hsnCode read from that same stanza is then source-suspect too (reported, never auto-corrected). */
  hsnCodeSourceSuspect: boolean;
  reasons: string[];
}

export interface HsnDescriptionSourceInput {
  specificationText: string | null | undefined;
  tableDescription: string | null | undefined;
  tableStyleName: string | null | undefined;
  /** The hsnCode the canonical path will persist; the HS line must agree with it before its label is trusted. */
  expectedHsnCode: string | null;
}

type Gender = 'BOYS' | 'GIRLS' | 'MIXED';
type ProductFamily = 'TOP' | 'BOTTOM' | 'DRESS';

export function detectGender(text: string | null | undefined): Gender | null {
  const value = (text ?? '').toLowerCase();
  const boys = /\bboy/.test(value);
  const girls = /\bgirl/.test(value);
  if (boys && girls) return 'MIXED';
  return boys ? 'BOYS' : girls ? 'GIRLS' : null;
}

/** Coarse garment family, only to catch an obvious identity contradiction (a trouser label on a hoody). Null when absent or when the text names more than one family. */
export function detectProductFamily(text: string | null | undefined): ProductFamily | null {
  const value = (text ?? '').toLowerCase().replace(/short\s*sleeve/g, ' ');
  const families = new Set<ProductFamily>();
  if (/hood|shirt|\btee\b|top\b|sweater|jacket/.test(value)) families.add('TOP');
  if (/pant|jogger|short|trouser|legging|skirt/.test(value)) families.add('BOTTOM');
  if (/dress/.test(value)) families.add('DRESS');
  return families.size === 1 ? [...families][0]! : null;
}

function baseResolution(overrides: Partial<HsnDescriptionResolution>): HsnDescriptionResolution {
  return {
    classification: 'NO_HS_LINE',
    semanticCheck: 'NOT_APPLICABLE',
    rawHsLine: null,
    parsedHsnCode: null,
    candidateHsnDescription: null,
    proposedHsnDescription: null,
    st1Text: null,
    hsnCodeSourceSuspect: false,
    reasons: [],
    ...overrides,
  };
}

export function resolveHsnSourceDescription(input: HsnDescriptionSourceInput): HsnDescriptionResolution {
  const lines = (input.specificationText ?? '').split('\n');
  const hsLines = lines.filter((line) => HS_LINE_START.test(line));
  const st1Text = lines.find((line) => ST1_LINE_START.test(line))?.trim() ?? null;

  if (hsLines.length === 0) {
    return baseResolution({ st1Text, reasons: ['No *HS line in the source specification stanza.'] });
  }
  if (hsLines.length > 1) {
    return baseResolution({ classification: 'REVIEW_REQUIRED', st1Text, rawHsLine: hsLines.join(' | '), reasons: [`${hsLines.length} *HS lines in one source document — cannot choose one.`] });
  }
  const rawHsLine = hsLines[0]!;
  const parsed = parseHsnSourceLine(rawHsLine);
  if (!parsed) {
    return baseResolution({ classification: 'PARSE_ERROR', st1Text, rawHsLine, reasons: ['*HS line does not match the approved code/description boundary.'] });
  }
  const common = { st1Text, rawHsLine, parsedHsnCode: parsed.hsnCode, candidateHsnDescription: parsed.candidateDescription };

  if (input.expectedHsnCode !== parsed.hsnCode) {
    return baseResolution({
      ...common,
      classification: 'REVIEW_REQUIRED',
      semanticCheck: 'HSN_CODE_MISMATCH',
      reasons: [`*HS line code ${parsed.hsnCode} does not equal the hsnCode being persisted (${input.expectedHsnCode ?? 'null'}).`],
    });
  }
  if (parsed.candidateDescription === null) {
    return baseResolution({ ...common, classification: 'HSN_CODE_ONLY', reasons: ['Numeric HSN with no trailing source text.'] });
  }

  const candidate = parsed.candidateDescription;
  const tableText = [input.tableDescription, input.tableStyleName].filter(Boolean).join(' ');
  const review = (semanticCheck: HsnSemanticCheck, reason: string, hsnCodeSourceSuspect = false) =>
    baseResolution({ ...common, classification: 'REVIEW_REQUIRED', semanticCheck, hsnCodeSourceSuspect, reasons: [reason] });

  // 1. The table and this PDF's own *ST1 must describe the same style; if
  //    not, the whole *ST1/*HS stanza (code included) belongs to another one.
  const tableGender = detectGender(tableText);
  const st1Gender = detectGender(st1Text);
  const tableFamily = detectProductFamily(tableText);
  const st1Family = detectProductFamily(st1Text);
  if ((tableGender && st1Gender && tableGender !== st1Gender) || (tableFamily && st1Family && tableFamily !== st1Family)) {
    return review(
      'SOURCE_BLOCK_CONFLICT',
      `PDF table ("${tableText}") and *ST1 ("${st1Text}") describe different styles; the *ST1/*HS stanza appears copied from another style, so its HS label — and the hsnCode read from the same line — are source-suspect.`,
      true,
    );
  }
  // 3. Spillover / not-a-label checks.
  if (!/[a-z]/i.test(candidate)) return review('SPILLOVER', `Trailing text "${candidate}" is punctuation/numeric only.`);
  if (SPILLOVER.test(candidate)) return review('SPILLOVER', `Trailing text "${candidate}" contains neighboring-stanza wording.`);
  if (candidate.length > MAX_DESCRIPTION_LENGTH) return review('SPILLOVER', `Trailing text is ${candidate.length} characters — longer than any source HS label.`);
  // 2. Any gender the label names must be the table's gender.
  const labelGender = detectGender(candidate);
  if (labelGender && labelGender !== tableGender) {
    return review('GENDER_CONFLICT', `HS label says ${labelGender} but the PDF table says ${tableGender ?? 'no gender'} ("${tableText}").`);
  }
  const labelFamily = detectProductFamily(candidate);
  if (labelFamily && tableFamily && labelFamily !== tableFamily) {
    return review('PRODUCT_CONFLICT', `HS label names a ${labelFamily} garment but the PDF table describes a ${tableFamily} ("${tableText}").`);
  }

  return baseResolution({
    ...common,
    classification: 'HSN_WITH_SOURCE_DESCRIPTION',
    semanticCheck: 'PASS',
    proposedHsnDescription: candidate,
    reasons: ['Source HS label is consistent with the PDF table and *ST1.'],
  });
}
