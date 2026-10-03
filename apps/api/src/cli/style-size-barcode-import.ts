// Loads AUTHORITATIVE barcodes (from a business spreadsheet) onto EXISTING
// Style + Size rows. This is deliberately narrow: it never creates Styles,
// Sizes or mappings and never generates a barcode. A supplied value is stored
// exactly as written; anything that cannot be applied unambiguously is
// reported and skipped, and an existing different barcode is never overwritten.
//
// Expected columns (header names case-insensitive, any order):
//   Barcode (required)
//   Size    (required)            - Size code or label ("AGE_3", "3", "3Y")
//   Style Number                  - OR - Season + LMIX (to identify the Style)
import * as XLSX from 'xlsx';
import { prisma } from '../db/prisma.js';
import { parseSizeNumber, SUPPLIED_BARCODE_PATTERN } from '../modules/master-data/barcode.util.js';

export interface SheetRow {
  /** 1-indexed row as shown in the spreadsheet (header is row 1). */
  rowNumber: number;
  styleNumber: string;
  season: string;
  lmix: string;
  size: string;
  barcode: string;
}

export type ImportRejection =
  | 'MALFORMED_ROW'
  | 'INVALID_BARCODE'
  | 'UNKNOWN_STYLE'
  | 'AMBIGUOUS_STYLE'
  | 'UNKNOWN_SIZE'
  | 'AMBIGUOUS_SIZE'
  | 'MAPPING_NOT_FOUND'
  | 'CONFLICTING_ROWS'
  | 'DUPLICATE_BARCODE_IN_FILE'
  | 'BARCODE_ASSIGNED_ELSEWHERE'
  | 'EXISTING_BARCODE_DIFFERS';

export interface ImportRow {
  rowNumber: number;
  label: string;
  barcode: string;
  detail: string;
}

export interface ImportPlan {
  totalRows: number;
  wouldSet: Array<ImportRow & { styleSizeId: string }>;
  alreadyApplied: ImportRow[];
  duplicateRows: ImportRow[];
  rejected: Record<ImportRejection, ImportRow[]>;
}

const HEADERS: Record<string, keyof Omit<SheetRow, 'rowNumber'>> = {
  'style number': 'styleNumber',
  stylenumber: 'styleNumber',
  season: 'season',
  lmix: 'lmix',
  'lmix number': 'lmix',
  size: 'size',
  barcode: 'barcode',
};

export function parseBarcodeSheet(buffer: Buffer): SheetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new Error('The file has no sheets');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  const header = (raw[0] ?? []).map((cell) => HEADERS[String(cell).trim().toLowerCase()]);
  if (!header.includes('barcode') || !header.includes('size')) {
    throw new Error('Header row must include "Barcode" and "Size" columns');
  }
  if (!header.includes('styleNumber') && !(header.includes('season') && header.includes('lmix'))) {
    throw new Error('Header row must include "Style Number", or both "Season" and "LMIX"');
  }
  return raw.slice(1).map((cells, index) => {
    const row: SheetRow = { rowNumber: index + 2, styleNumber: '', season: '', lmix: '', size: '', barcode: '' };
    header.forEach((key, column) => {
      if (key) row[key] = String(cells[column] ?? '').trim();
    });
    return row;
  });
}

// The business "Book1" layout: Season ("AW-25"), Style Number (= the LMIX
// digits) and Barcode, with NO Size column. The three historical seasons are
// three barcode regimes, so the size is read back out of the barcode itself:
//   AW25: <XJGGR><lmix>-<n>Y   (alphanumeric, kept verbatim)
//   SS26: <lmix><n>            (no season prefix)
//   AW26: 3<lmix><n>           (Season serial 3 + LMIX + size numeral)
// A row that does not match its season's regime exactly gets an empty size and
// is rejected by the plan - the size is never guessed.
const LEGACY_REGIMES: Record<string, (lmix: string, barcode: string) => string | null> = {
  AW25: (lmix, barcode) => {
    const match = /^[A-Z]{5}(\d+)-(\d{1,2})Y$/.exec(barcode);
    return match && match[1] === lmix ? match[2]! : null;
  },
  SS26: (lmix, barcode) => sizeAfterPrefix(lmix, barcode),
  AW26: (lmix, barcode) => sizeAfterPrefix(`3${lmix}`, barcode),
};

// The Style's true LMIX from the sheet's "Style Number". The AW25 workbook base
// code has digits 4-5 transposed relative to the LMIX stored on the Style
// (rule approved in H2A: it resolves all 42 AW25 Styles uniquely). The barcode
// itself still embeds the sheet's code and is kept verbatim.
const LEGACY_LMIX: Record<string, (digits: string) => string> = {
  AW25: (digits) => (digits.length >= 5 ? `${digits.slice(0, 3)}${digits[4]}${digits[3]}${digits.slice(5)}` : digits),
};

function sizeAfterPrefix(prefix: string, barcode: string): string | null {
  if (!barcode.startsWith(prefix)) return null;
  const rest = barcode.slice(prefix.length);
  return /^[1-9]\d?$/.test(rest) ? rest : null;
}

export function parseLegacyBarcodeBook(buffer: Buffer): SheetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new Error('The file has no sheets');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  // Header cells can contain line breaks / padding (" Style\r\nNumber ").
  const header = (raw[0] ?? []).map((cell) => String(cell).replace(/\s+/g, ' ').trim().toLowerCase());
  const [season, style, barcode] = [header.indexOf('season'), header.indexOf('style number'), header.indexOf('barcode')];
  if (season < 0 || style < 0 || barcode < 0) {
    throw new Error('Header row must include "Season", "Style Number" and "Barcode" columns');
  }
  return raw.slice(1).map((cells, index) => {
    const seasonCode = String(cells[season] ?? '').replace(/[\s-]/g, '').toUpperCase();
    const lmixDigits = String(cells[style] ?? '').trim();
    const code = String(cells[barcode] ?? '').trim();
    const derive = LEGACY_REGIMES[seasonCode];
    return {
      rowNumber: index + 2,
      styleNumber: '',
      season: seasonCode,
      lmix: lmixDigits ? `LMIX${LEGACY_LMIX[seasonCode]?.(lmixDigits) ?? lmixDigits}` : '',
      size: (derive && lmixDigits && code ? derive(lmixDigits, code) : null) ?? '',
      barcode: code,
    };
  });
}

interface Catalog {
  styles: Array<{ id: string; styleNumber: string; lmixNumber: string | null; seasonCode: string }>;
  sizes: Array<{ id: string; code: string; label: string; sizeType: string }>;
  styleSizes: Array<{ id: string; styleId: string; sizeId: string; barcode: string | null }>;
}

export async function loadCatalog(): Promise<Catalog> {
  const [styles, sizes, styleSizes] = await Promise.all([
    prisma.style.findMany({ select: { id: true, styleNumber: true, lmixNumber: true, season: { select: { code: true } } } }),
    prisma.size.findMany({ select: { id: true, code: true, label: true, sizeType: true } }),
    prisma.styleSize.findMany({ select: { id: true, styleId: true, sizeId: true, barcode: true } }),
  ]);
  return {
    styles: styles.map((s) => ({ id: s.id, styleNumber: s.styleNumber, lmixNumber: s.lmixNumber, seasonCode: s.season.code })),
    sizes,
    styleSizes,
  };
}

const norm = (value: string) => value.trim().toUpperCase();

function resolveSize(catalog: Catalog, value: string): { id: string } | 'UNKNOWN_SIZE' | 'AMBIGUOUS_SIZE' {
  const key = norm(value);
  const exact = catalog.sizes.filter((s) => norm(s.code) === key);
  const byLabel = exact.length ? exact : catalog.sizes.filter((s) => norm(s.label) === key);
  let matches = byLabel;
  if (matches.length === 0) {
    // "3Y" -> the AGE/NUMERIC size whose own numeric value is 3 (same parser the generator uses).
    const wanted = parseSizeNumber(value, 'AGE');
    if (wanted) matches = catalog.sizes.filter((s) => parseSizeNumber(s.label, s.sizeType) === wanted);
  }
  if (matches.length === 0) return 'UNKNOWN_SIZE';
  return matches.length > 1 ? 'AMBIGUOUS_SIZE' : { id: matches[0]!.id };
}

/** Pure planning step: no I/O, no writes. */
export function planBarcodeImport(rows: SheetRow[], catalog: Catalog): ImportPlan {
  const plan: ImportPlan = {
    totalRows: rows.length,
    wouldSet: [],
    alreadyApplied: [],
    duplicateRows: [],
    rejected: {
      MALFORMED_ROW: [], INVALID_BARCODE: [], UNKNOWN_STYLE: [], AMBIGUOUS_STYLE: [], UNKNOWN_SIZE: [],
      AMBIGUOUS_SIZE: [], MAPPING_NOT_FOUND: [], CONFLICTING_ROWS: [], DUPLICATE_BARCODE_IN_FILE: [],
      BARCODE_ASSIGNED_ELSEWHERE: [], EXISTING_BARCODE_DIFFERS: [],
    },
  };
  const holderByBarcode = new Map(
    catalog.styleSizes.filter((ss) => ss.barcode !== null).map((ss) => [ss.barcode!, ss.id] as const),
  );
  const mappingByKey = new Map(catalog.styleSizes.map((ss) => [`${ss.styleId}|${ss.sizeId}`, ss] as const));

  const reject = (reason: ImportRejection, row: SheetRow, detail: string) =>
    plan.rejected[reason].push(describeRow(row, detail));

  // 1. Resolve each row to one concrete Style + Size mapping.
  const resolved: Array<{ row: SheetRow; mapping: Catalog['styleSizes'][number] }> = [];
  for (const row of rows) {
    if (!row.barcode || !row.size || (!row.styleNumber && !(row.season && row.lmix))) {
      reject('MALFORMED_ROW', row, 'missing barcode, size or style identifier');
      continue;
    }
    if (!SUPPLIED_BARCODE_PATTERN.test(row.barcode)) {
      reject('INVALID_BARCODE', row, 'barcode must be 1-64 printable characters without spaces');
      continue;
    }
    const styles = row.styleNumber
      ? catalog.styles.filter((s) => s.styleNumber === row.styleNumber)
      : catalog.styles.filter((s) => norm(s.seasonCode) === norm(row.season) && norm(s.lmixNumber ?? '') === norm(row.lmix));
    if (styles.length === 0) { reject('UNKNOWN_STYLE', row, 'no such Style'); continue; }
    if (styles.length > 1) { reject('AMBIGUOUS_STYLE', row, `${styles.length} Styles match`); continue; }
    const size = resolveSize(catalog, row.size);
    if (typeof size === 'string') { reject(size, row, `size "${row.size}" ${size === 'UNKNOWN_SIZE' ? 'not found' : 'matches more than one Size'}`); continue; }
    const mapping = mappingByKey.get(`${styles[0]!.id}|${size.id}`);
    if (!mapping) { reject('MAPPING_NOT_FOUND', row, `Style ${styles[0]!.styleNumber} is not mapped to size "${row.size}" (this tool never creates mappings)`); continue; }
    resolved.push({ row, mapping });
  }

  // 2. Within the file: identical repeats are harmless; anything contradictory is rejected whole.
  const byMapping = new Map<string, typeof resolved>();
  const byBarcode = new Map<string, typeof resolved>();
  for (const item of resolved) {
    byMapping.set(item.mapping.id, [...(byMapping.get(item.mapping.id) ?? []), item]);
    byBarcode.set(item.row.barcode, [...(byBarcode.get(item.row.barcode) ?? []), item]);
  }
  const seenMapping = new Set<string>();
  for (const { row, mapping } of resolved) {
    const sameMapping = byMapping.get(mapping.id)!;
    if (new Set(sameMapping.map((i) => i.row.barcode)).size > 1) {
      reject('CONFLICTING_ROWS', row, 'the same Style + Size appears with different barcodes');
      continue;
    }
    if (new Set(byBarcode.get(row.barcode)!.map((i) => i.mapping.id)).size > 1) {
      reject('DUPLICATE_BARCODE_IN_FILE', row, `barcode ${row.barcode} is listed for more than one Style + Size`);
      continue;
    }
    if (seenMapping.has(mapping.id)) {
      plan.duplicateRows.push(describeRow(row, 'repeat of an identical row'));
      continue;
    }
    seenMapping.add(mapping.id);

    // 3. Against the database: never overwrite, never steal.
    const holder = holderByBarcode.get(row.barcode);
    if (mapping.barcode === row.barcode) {
      plan.alreadyApplied.push(describeRow(row, 'already set'));
    } else if (mapping.barcode !== null) {
      reject('EXISTING_BARCODE_DIFFERS', row, `already has barcode ${mapping.barcode}; not overwritten`);
    } else if (holder && holder !== mapping.id) {
      reject('BARCODE_ASSIGNED_ELSEWHERE', row, `barcode ${row.barcode} is already assigned to another Style + Size`);
    } else {
      plan.wouldSet.push({ ...describeRow(row, 'will set exactly as supplied'), styleSizeId: mapping.id });
    }
  }
  return plan;
}

function describeRow(row: SheetRow, detail: string): ImportRow {
  const style = row.styleNumber || `${row.season} ${row.lmix}`;
  return { rowNumber: row.rowNumber, label: `${style} / size ${row.size}`, barcode: row.barcode, detail };
}

export function summarizeImport(plan: ImportPlan) {
  const rejected = Object.values(plan.rejected).reduce((sum, rows) => sum + rows.length, 0);
  return {
    totalRows: plan.totalRows,
    wouldSet: plan.wouldSet.length,
    alreadyApplied: plan.alreadyApplied.length,
    duplicateRows: plan.duplicateRows.length,
    rejected,
  };
}

/** Writes in transaction-safe batches; each write only fills a row that is still NULL. */
export async function executeBarcodeImport(plan: ImportPlan, batchSize = 200): Promise<{ written: number; skippedFilled: number }> {
  let written = 0;
  let skippedFilled = 0;
  for (let start = 0; start < plan.wouldSet.length; start += batchSize) {
    const batch = plan.wouldSet.slice(start, start + batchSize);
    await prisma.$transaction(async (tx) => {
      for (const item of batch) {
        const result = await tx.styleSize.updateMany({ where: { id: item.styleSizeId, barcode: null }, data: { barcode: item.barcode } });
        written += result.count;
        skippedFilled += 1 - result.count;
      }
    });
  }
  return { written, skippedFilled };
}
