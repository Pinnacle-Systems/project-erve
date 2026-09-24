// Parser for the business-supplied "MRP & Ex factory cost.xlsx" workbook
// (H2A continuation — MRP/Ex-Factory Reconciliation). Pure, file-I/O-free:
// takes already-loaded raw row arrays (as `xlsx`'s `sheet_to_json({header:1})`
// returns them) and returns structured rows plus any data-quality issues
// found — never guesses at a blank/malformed value, never mutates input.
//
// The workbook has no explicit LMIX column. Its numeric "Base code" column
// is, empirically, the historical LMIX numeric suffix — but for AW25 rows
// it is consistently transposed at digit positions 4-5 (0-indexed 3-4)
// relative to the already-approved historical LMIX values (verified against
// all 91 required Season+LMIX identities: AW25 rows resolve only via the
// transposed key, SS26 rows only via the direct key, with zero ambiguity
// either way — see mrp-reconciliation.ts, which tries both keys per row
// rather than assuming either one, and treats an identity matching via both
// (or neither) as REVIEW_REQUIRED/BLOCKED, never a guess).
export const EXPECTED_MRP_WORKBOOK_HEADER = [
  'Season',
  'Heads',
  'Description',
  "IP's",
  'Category',
  'Licensor',
  'Factory',
  'Base code',
  'MRP',
  'Exfactory',
  'Factory',
  'Colour',
  'Season',
] as const;

export type MrpWorkbookIssueCode =
  | 'BLANK_BASECODE'
  | 'BLANK_MRP'
  | 'MALFORMED_MRP'
  | 'BLANK_EXFACTORY'
  | 'MALFORMED_EXFACTORY'
  | 'BLANK_SEASON'
  | 'SEASON_COLUMN_MISMATCH'
  | 'FACTORY_COLUMN_MISMATCH';

export interface MrpWorkbookIssue {
  code: MrpWorkbookIssueCode;
  detail: string;
}

export interface MrpWorkbookRow {
  /** 1-indexed row number as it appears in the actual .xlsx sheet (header is row 1), so any finding is traceable back to its original business row. */
  excelRow: number;
  seasonRaw: string | null;
  /** Normalized for matching only: uppercased, hyphens/spaces stripped ("AW-25" -> "AW25"). */
  season: string | null;
  description: string | null;
  ipName: string | null;
  category: string | null;
  licensor: string | null;
  factoryRaw: string | null;
  baseCodeRaw: string | number | null;
  /** Base code as a plain digit string (no sign, no decimal), or null if blank/unparseable. */
  baseCodeDigits: string | null;
  mrp: number | null;
  exFactoryCost: number | null;
  colour: string | null;
  issues: MrpWorkbookIssue[];
}

export class MrpWorkbookError extends Error {}

export function validateMrpWorkbookHeader(header: unknown[]): { valid: boolean; reason: string | null } {
  if (header.length < EXPECTED_MRP_WORKBOOK_HEADER.length) {
    return { valid: false, reason: `Expected ${EXPECTED_MRP_WORKBOOK_HEADER.length} columns, found ${header.length}` };
  }
  for (let i = 0; i < EXPECTED_MRP_WORKBOOK_HEADER.length; i++) {
    const actual = String(header[i] ?? '').trim();
    const expected = EXPECTED_MRP_WORKBOOK_HEADER[i];
    if (actual !== expected) {
      return { valid: false, reason: `Column ${i + 1}: expected "${expected}", found "${actual}"` };
    }
  }
  return { valid: true, reason: null };
}

export function normalizeMrpSeason(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw).replace(/[-\s]/g, '').toUpperCase();
}

function toDigitString(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return null;
    return String(raw);
  }
  const trimmed = String(raw).trim();
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

function toPositiveFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}

/**
 * The AW25-only digit-transposition candidate: swaps the 4th and 5th
 * characters of an 8-digit code (e.g. "39042013" -> "39024013"). Returns
 * null for any code that isn't exactly 8 digits — this transformation was
 * verified only against 8-digit Base codes and must never be guessed at for
 * a different length.
 */
export function transposedBaseCodeDigits(digits: string): string | null {
  if (!/^\d{8}$/.test(digits)) return null;
  const chars = digits.split('');
  const tmp = chars[3]!;
  chars[3] = chars[4]!;
  chars[4] = tmp;
  return chars.join('');
}

/**
 * Parses one raw workbook row (as returned by `xlsx`'s
 * `sheet_to_json({ header: 1 })`, i.e. one array per row, aligned to
 * EXPECTED_MRP_WORKBOOK_HEADER's column order) into a structured
 * MrpWorkbookRow, recording (never silently dropping) every blank or
 * malformed value found.
 */
export function parseMrpWorkbookRow(rawRow: unknown[], excelRow: number): MrpWorkbookRow {
  const [seasonRaw, , description, ipName, category, licensor, factoryRaw, baseCodeRaw, mrpRaw, exFactoryRaw, factory2Raw, colour, season2Raw] = rawRow;
  const issues: MrpWorkbookIssue[] = [];

  if (seasonRaw === null || seasonRaw === undefined || seasonRaw === '') {
    issues.push({ code: 'BLANK_SEASON', detail: 'Season column is blank' });
  }
  if (String(seasonRaw ?? '') !== String(season2Raw ?? '')) {
    issues.push({ code: 'SEASON_COLUMN_MISMATCH', detail: `Column A ("${String(seasonRaw ?? '')}") and column M ("${String(season2Raw ?? '')}") disagree` });
  }
  if (String(factoryRaw ?? '') !== String(factory2Raw ?? '')) {
    issues.push({ code: 'FACTORY_COLUMN_MISMATCH', detail: `Column G ("${String(factoryRaw ?? '')}") and column K ("${String(factory2Raw ?? '')}") disagree` });
  }

  const baseCodeDigits = toDigitString(baseCodeRaw);
  if (baseCodeRaw === null || baseCodeRaw === undefined || baseCodeRaw === '') {
    issues.push({ code: 'BLANK_BASECODE', detail: 'Base code column is blank' });
  }

  let mrp: number | null = null;
  if (mrpRaw === null || mrpRaw === undefined || mrpRaw === '') {
    issues.push({ code: 'BLANK_MRP', detail: 'MRP column is blank' });
  } else {
    mrp = toPositiveFiniteNumber(mrpRaw);
    if (mrp === null || mrp <= 0) {
      issues.push({ code: 'MALFORMED_MRP', detail: `MRP value "${String(mrpRaw)}" is not a valid positive number` });
      mrp = null;
    }
  }

  let exFactoryCost: number | null = null;
  if (exFactoryRaw === null || exFactoryRaw === undefined || exFactoryRaw === '') {
    issues.push({ code: 'BLANK_EXFACTORY', detail: 'Exfactory column is blank' });
  } else {
    exFactoryCost = toPositiveFiniteNumber(exFactoryRaw);
    if (exFactoryCost === null || exFactoryCost <= 0) {
      issues.push({ code: 'MALFORMED_EXFACTORY', detail: `Exfactory value "${String(exFactoryRaw)}" is not a valid positive number` });
      exFactoryCost = null;
    }
  }

  return {
    excelRow,
    seasonRaw: seasonRaw === null || seasonRaw === undefined ? null : String(seasonRaw),
    season: normalizeMrpSeason(seasonRaw),
    description: description === null || description === undefined ? null : String(description),
    ipName: ipName === null || ipName === undefined ? null : String(ipName),
    category: category === null || category === undefined ? null : String(category),
    licensor: licensor === null || licensor === undefined ? null : String(licensor),
    factoryRaw: factoryRaw === null || factoryRaw === undefined ? null : String(factoryRaw),
    baseCodeRaw: (baseCodeRaw as string | number | null) ?? null,
    baseCodeDigits,
    mrp,
    exFactoryCost,
    colour: colour === null || colour === undefined ? null : String(colour),
    issues,
  };
}

/** Parses every data row (row 2 onward) of the sheet. Throws MrpWorkbookError if the header (row 1) doesn't match EXPECTED_MRP_WORKBOOK_HEADER — this parser never guesses at column meanings for an unrecognized layout. */
export function parseMrpWorkbookRows(sheetRows: unknown[][]): MrpWorkbookRow[] {
  if (sheetRows.length === 0) {
    throw new MrpWorkbookError('Workbook sheet is empty — no header row found');
  }
  const [header, ...dataRows] = sheetRows;
  const headerCheck = validateMrpWorkbookHeader(header!);
  if (!headerCheck.valid) {
    throw new MrpWorkbookError(`Unrecognized MRP workbook header layout: ${headerCheck.reason}`);
  }
  return dataRows
    .map((row, i) => ({ row, excelRow: i + 2 }))
    .filter(({ row }) => row.some((cell) => cell !== null && cell !== undefined && cell !== ''))
    .map(({ row, excelRow }) => parseMrpWorkbookRow(row, excelRow));
}

export interface NormalizedMrpCategory {
  categoryRaw: string | null;
  categoryNormalized: string | null;
  normalizationApplied: boolean;
}

/**
 * H2B.2 Stage A finding: the workbook's `Description` column is built by
 * literal concatenation (`IP's + Category + last-3-digits(Base code)` for
 * every AW25 row, verified exact on 42/42) — so a trailing "-" on `Category`
 * is the separator character the concatenation left behind, not business
 * data. This strips exactly ONE trailing separator hyphen (plus adjacent
 * whitespace) and nothing else: internal hyphens ("Co-Ord Set") are
 * untouched, and the rule is expressed as "one trailing separator hyphen",
 * never "if season is AW25" — the artifact happens to be 100% AW25/0% SS26
 * in the audited data, but the rule must describe the data shape, not guess
 * at a season split that could stop holding for a future workbook.
 */
export function normalizeMrpCategory(raw: string | null | undefined): NormalizedMrpCategory {
  if (raw === null || raw === undefined) {
    return { categoryRaw: null, categoryNormalized: null, normalizationApplied: false };
  }
  const trimmed = raw.trim();
  const withoutTrailingSeparator = trimmed.replace(/-\s*$/, '').trim();
  const categoryNormalized = withoutTrailingSeparator.length > 0 ? withoutTrailingSeparator : null;
  return {
    categoryRaw: raw,
    categoryNormalized,
    normalizationApplied: categoryNormalized !== trimmed,
  };
}
