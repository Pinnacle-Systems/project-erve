// File-only adapters. No Prisma, domain mutation, or environment imports.
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  normalizeMrpSeason,
  transposedBaseCodeDigits,
} from '../modules/historical-import/mrp-workbook.js';

export type CanonicalRow = Record<string, string | number>;
export interface PhysicalRow {
  rowNumber: number;
  cells: unknown[];
}
export interface SourceLocation {
  sha256: string;
  worksheet: string;
  rowNumber: number;
  file?: string;
}
export interface SourceException {
  code: string;
  detail: string;
  rawValues: string;
  rowNumber?: number;
  worksheet?: string;
  file?: string;
  sourceSha256?: string;
  sourceKey?: string;
  outcome: 'NEEDS_REVIEW' | 'REJECTED';
}
export interface ReviewedCorrection {
  sourceSha256: string;
  worksheet: string;
  rowNumber: number;
  sourceKey: string;
  field: string;
  previousValue: string | number;
  value: string | number;
  status: 'APPROVED' | 'NEEDS_REVIEW';
  reviewedBy: string;
  reason: string;
}
const address = ['Address Line 1', 'Address Line 2', 'City', 'State', 'Postal Code'];
const contact = ['Contact Person', 'Phone', 'Email'];
const provenance = ['Source Key', 'Source Provenance'];
export const FACTORY_HEADERS = ['Name', ...address, ...contact, ...provenance];
export const DISTRIBUTOR_HEADERS = [
  'Name',
  'GSTIN',
  'Purchase Mode',
  ...address,
  ...contact,
  ...provenance,
];
export const STORE_HEADERS = [
  'Distributor GSTIN',
  'Distributor Name',
  'Distributor Purchase Mode',
  'Name',
  ...address,
  ...contact,
  ...provenance,
];
export const STYLE_HEADERS = [
  'Style Number',
  'Style Name',
  'Final MRP',
  'Season Code',
  'Size Codes',
  'LMIX Number',
  'HSN Code',
  'Barcodes',
  'Factory Mappings',
  'Financial Year',
  'Factory Name Mappings',
  'Business Style',
  'Description',
  'Colour',
  'IP Name',
  'Licensor',
  'Category',
  ...provenance,
];
export const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const normalized = (v: unknown): string =>
  text(v).normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
export const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export function businessSourceKey(entity: string, verifiedFields: unknown[]): string {
  return `${entity}:v1:${sha256(JSON.stringify(verifiedFields.map(normalized)))}`;
}
export function finding(
  code: string,
  detail: string,
  raw: unknown,
  location?: Partial<SourceLocation>,
  sourceKey?: string,
): SourceException {
  return {
    code,
    detail,
    rawValues: JSON.stringify(raw),
    outcome: 'NEEDS_REVIEW',
    rowNumber: location?.rowNumber,
    worksheet: location?.worksheet,
    file: location?.file,
    sourceSha256: location?.sha256,
    sourceKey,
  };
}
export function readExplicitSheet(bytes: Buffer, worksheet: string) {
  if (!worksheet) throw new Error('An explicit worksheet name is required');
  const workbook = XLSX.read(bytes, { type: 'buffer', raw: true, cellFormula: true });
  return readWorkbookSheet(workbook, worksheet);
}
export function readWorkbookSheet(workbook: XLSX.WorkBook, worksheet: string) {
  if (!worksheet) throw new Error('An explicit worksheet name is required');
  const sheet = workbook.Sheets[worksheet];
  if (!sheet) throw new Error(`Worksheet "${worksheet}" is absent`);
  const rows: PhysicalRow[] = [];
  const errors: Array<{ rowNumber: number; column: string; value: string }> = [];
  if (sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let r = 0; r <= range.e.r; r++) {
      const cells: unknown[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        cells[c] = cell?.t === 'e' ? (cell.w ?? XLSX.utils.format_cell(cell)) : (cell?.v ?? null);
        if (cell?.t === 'e')
          errors.push({
            rowNumber: r + 1,
            column: XLSX.utils.encode_col(c),
            value: text(cells[c]),
          });
      }
      rows.push({ rowNumber: r + 1, cells });
    }
  }
  return { rows, errors, sheetNames: workbook.SheetNames, worksheet, range: sheet['!ref'] ?? '' };
}
export function applyCorrections(
  row: CanonicalRow,
  location: SourceLocation,
  corrections: ReviewedCorrection[],
): CanonicalRow {
  const result = { ...row };
  for (const c of corrections.filter(
    (c) => c.sourceKey === row['Source Key'] && c.status === 'APPROVED',
  )) {
    if (c.sourceSha256 !== location.sha256)
      throw new Error(`Correction checksum mismatch for ${c.sourceKey}`);
    if (c.worksheet !== location.worksheet || c.rowNumber !== location.rowNumber)
      throw new Error(`Correction worksheet/physical row mismatch for ${c.sourceKey}`);
    if (!c.reviewedBy.trim() || !c.reason.trim())
      throw new Error('Approved corrections require reviewer and reason');
    if (c.field === 'Source Key' || c.field === 'Source Provenance' || !(c.field in result))
      throw new Error(`Unsupported correction field ${c.field}`);
    if (result[c.field] !== c.previousValue)
      throw new Error(`Correction previous value mismatch for ${c.sourceKey}`);
    result[c.field] = c.value;
  }
  return result;
}
export function resolveCommercialIdentity(
  season: string,
  businessStyle: string,
  poIdentities: Array<{ season: string; lmix: string }>,
) {
  const direct = `LMIX${businessStyle}`;
  const transposed = season === 'AW25' ? transposedBaseCodeDigits(businessStyle) : null;
  const candidates = poIdentities.filter(
    (p) =>
      p.season === season && (p.lmix === direct || (transposed && p.lmix === `LMIX${transposed}`)),
  );
  const matches = [...new Set(candidates.map((p) => p.lmix))];
  if (matches.length > 1) throw new Error(`Ambiguous PO identity ${season}/${businessStyle}`);
  if (matches.length === 1)
    return {
      lmix: matches[0]!,
      method: matches[0] === direct ? 'DIRECT_VERIFIED_PO' : 'AW25_VERIFIED_DIGIT_TRANSPOSITION',
    };
  return { lmix: direct, method: 'COMMERCIAL_SOURCE_ONLY' };
}
export interface BarcodeSourceRow {
  rowNumber: number;
  season: string;
  businessStyle: string;
  size: string;
  barcode: string;
  raw: unknown[];
}
export function parseBarcodeRows(rows: PhysicalRow[]) {
  const header = rows[0]?.cells.map((v) => normalized(v).replace(/\s+/g, ' ')) ?? [];
  const columns = ['SEASON', 'STYLE NUMBER', 'BARCODE'].map((h) => header.indexOf(h));
  if (columns.some((c) => c < 0))
    throw new Error('Book1 requires Season, Style Number and Barcode headers');
  const records: BarcodeSourceRow[] = [];
  const exceptions: SourceException[] = [];
  const identities = new Map<string, string>();
  const holders = new Map<string, string>();
  for (const row of rows.slice(1)) {
    if (!row.cells.some((v) => v !== null && v !== '')) continue;
    const season = normalizeMrpSeason(row.cells[columns[0]!]) ?? '';
    const businessStyle = text(row.cells[columns[1]!]).trim();
    const barcode = text(row.cells[columns[2]!]);
    let size = '';
    if (season === 'AW25') {
      const match = /^[A-Z]{5}(\d+)-(\d{1,2})Y$/.exec(barcode);
      if (match?.[1] === businessStyle) size = match[2]!;
    } else if (season === 'SS26' || season === 'AW26') {
      const prefix = `${season === 'AW26' ? '3' : ''}${businessStyle}`;
      if (barcode.startsWith(prefix) && /^[1-9]\d?$/.test(barcode.slice(prefix.length)))
        size = barcode.slice(prefix.length);
    }
    if (!size || Number(size) < 3 || Number(size) > 14 || !/^\d{7,8}$/.test(businessStyle)) {
      exceptions.push(
        finding(
          'BARCODE_SIZE_UNRESOLVED',
          'Barcode does not match documented season/style/size regime',
          row.cells,
          row,
        ),
      );
      size = '';
    }
    const key = `${season}|${businessStyle}|${size}`;
    if (size && identities.has(key) && identities.get(key) !== barcode)
      exceptions.push(
        finding(
          'BARCODE_CONFLICT',
          'Different supplied barcodes for one Style/Size; preserve both for review',
          [identities.get(key), barcode],
          row,
        ),
      );
    if (holders.has(barcode) && holders.get(barcode) !== key)
      exceptions.push(
        finding(
          'BARCODE_OWNERSHIP_CONFLICT',
          'Supplied barcode has multiple Style/Size owners',
          [holders.get(barcode), key],
          row,
        ),
      );
    identities.set(key, barcode);
    holders.set(barcode, key);
    records.push({
      rowNumber: row.rowNumber,
      season,
      businessStyle,
      size,
      barcode,
      raw: row.cells,
    });
  }
  return { records, exceptions };
}
export function storeCandidates(rows: PhysicalRow[]) {
  const records: CanonicalRow[] = [];
  const exceptions: SourceException[] = [];
  let parent = '';
  for (const row of rows) {
    if (typeof row.cells[0] === 'string' && /STORES/.test(normalized(row.cells[0]))) {
      const heading = normalized(row.cells[0]);
      parent = heading.startsWith('VINAYAK')
        ? 'VINAYAK'
        : heading.startsWith('G S CLOTHING')
          ? 'GS CLOTHING'
          : '';
      if (!parent)
        exceptions.push(
          finding('UNKNOWN_PARENT_HEADING', 'Store parent heading requires review', row.cells, row),
        );
      continue;
    }
    if (typeof row.cells[0] !== 'number' || !row.cells[1]) continue;
    const [name, city, state, addressLine1, postalCode, phone, email, gstin] = row.cells
      .slice(1)
      .map(text);
    const sourceKey = businessSourceKey('store', [
      parent,
      name,
      addressLine1,
      city,
      state,
      postalCode,
    ]);
    records.push({
      'Distributor GSTIN': '',
      'Distributor Name': parent,
      'Distributor Purchase Mode': '',
      Name: name!,
      'Address Line 1': addressLine1!,
      'Address Line 2': '',
      City: city!,
      State: state!,
      'Postal Code': postalCode!,
      'Contact Person': '',
      Phone: phone!,
      Email: email!,
      'Source Key': sourceKey,
      'Source Provenance': JSON.stringify({
        rowNumber: row.rowNumber,
        raw: row.cells,
        storeGstin: gstin,
      }),
    });
    if (!parent)
      exceptions.push(
        finding(
          'STORE_PARENT_UNRESOLVED',
          'Parent distributor requires verification',
          row.cells,
          row,
          sourceKey,
        ),
      );
    if (email?.endsWith('>'))
      exceptions.push(
        finding(
          'SOURCE_EMAIL_TRAILING_CHARACTER',
          'Preserved raw email; correction requires review',
          email,
          row,
          sourceKey,
        ),
      );
  }
  const groups = new Map<string, CanonicalRow[]>();
  for (const row of records) {
    const k = `${normalized(row['Distributor Name'])}|${normalized(row.Name)}`;
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  for (const [name, entries] of groups)
    if (entries.length > 1)
      exceptions.push(
        finding(
          'MULTIPLE_DESTINATIONS',
          `Same store name has ${entries.length} distinct address candidates; no merge`,
          entries.map((e) => JSON.parse(text(e['Source Provenance']))),
          undefined,
          name,
        ),
      );
  return { records, exceptions };
}
export function commercialConflicts(
  deep: PhysicalRow[],
  factory: PhysicalRow[],
  dispatch: PhysicalRow[],
): SourceException[] {
  const groups = new Map<string, Array<{ worksheet: string; rowNumber: number; value: unknown }>>();
  for (const [worksheet, rows] of [
    ['DeepStorewise Details', deep],
    ['Storewise Details factory', factory],
    ['Storewise dispatch address', dispatch],
  ] as const) {
    for (const row of rows)
      if (typeof row.cells[0] === 'number' && row.cells[1]) {
        const name = normalized(row.cells[1]);
        groups.set(name, [
          ...(groups.get(name) ?? []),
          { worksheet, rowNumber: row.rowNumber, value: row.cells[2] },
        ]);
      }
  }
  return [...groups]
    .filter(([, values]) => new Set(values.map((v) => v.value)).size > 1)
    .map(([name, values]) => ({
      ...finding(
        'STORE_COUNT_CONFLICT',
        `${name}: source summaries disagree; evidence ${JSON.stringify(values)}`,
        values.map((v) => v.value),
      ),
      worksheet: values.map((v) => v.worksheet).join(' | '),
      rowNumber: values[0]!.rowNumber,
    }));
}
interface ImageOwner {
  season: string;
  lmix: string;
  sourceSha256: string;
  imageSha256: string;
  imageOutcome: string;
  imageCollision: unknown;
}
export interface InvoiceEvidence {
  lineNumber: number;
  businessStyle: string;
  hsn: string;
  mrp: number;
  raw: string;
}
export function parseInvoiceLines(lines: string[]): InvoiceEvidence[] {
  const records: InvoiceEvidence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const identity = /^\d+\s+(\d{7,8})\s/.exec(raw);
    const amounts = /\s(\d{8})\s+([\d,]+\.\d{2})\s+\d+\s+Pcs\s/.exec(raw);
    if (identity && amounts)
      records.push({
        lineNumber: i + 1,
        businessStyle: identity[1]!,
        hsn: amounts[1]!,
        mrp: Number(amounts[2]!.replace(/,/g, '')),
        raw,
      });
  }
  return records;
}
export function validateImageOwnership(
  expected: ImageOwner,
  actual: ImageOwner & { actualSourceSha256: string; actualImageSha256: string },
): string | null {
  if (expected.season !== actual.season || expected.lmix !== actual.lmix)
    return 'Image identity differs from verified PO owner';
  if (
    expected.sourceSha256 !== actual.actualSourceSha256 ||
    expected.imageSha256 !== actual.actualImageSha256
  )
    return 'Image/source checksum mismatch';
  if (actual.imageCollision) return 'Image extraction collision requires review';
  if (actual.imageOutcome !== 'WRITTEN') return 'Image extraction outcome is not WRITTEN';
  return null;
}
