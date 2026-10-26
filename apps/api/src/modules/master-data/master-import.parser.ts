import * as XLSX from 'xlsx';
import type { MasterImportKind } from '@erve/types';
import { HttpError } from '../../errors/http-error.js';

const common = [
  'Address Line 1',
  'Address Line 2',
  'City',
  'State',
  'Country',
  'Postal Code',
  'Contact Person',
  'Phone',
  'Email',
];
export const masterImportHeaders: Record<MasterImportKind, string[]> = {
  seasons: [
    'Season Code',
    'Season Name',
    'Barcode Serial',
    'Status',
    'Source Key',
    'Source Provenance',
  ],
  sizes: [
    'Size Code',
    'Size Label',
    'Size Type',
    'Sort Order',
    'Status',
    'Source Key',
    'Source Provenance',
  ],
  hsns: [
    'HSN Code',
    'Description',
    'Status',
    'GST Rule Set Code',
    'Source Key',
    'Source Provenance',
  ],
  factories: ['Name', ...common, 'Source Key', 'Source Provenance'],
  distributors: ['Name', 'GSTIN', 'Purchase Mode', ...common, 'Source Key', 'Source Provenance'],
  'retail-stores': [
    'Distributor Name',
    'Distributor GSTIN',
    'Distributor Purchase Mode',
    'Name',
    ...common,
    'GSTIN',
    'Source Key',
    'Source Provenance',
  ],
};
export const masterImportWorksheets: Record<MasterImportKind, string> = {
  seasons: 'Seasons',
  sizes: 'Sizes',
  hsns: 'HSNs',
  factories: 'Factories',
  distributors: 'Distributors',
  'retail-stores': 'Retail stores',
};
/** Downloadable templates contain business fields only. Older imports with explicit
 * source keys/provenance remain accepted so historical data is not disrupted. */
export function buildMasterImportTemplate(kind: MasterImportKind): Buffer {
  const userHeaders = masterImportHeaders[kind].filter(
    (header) => header !== 'Source Key' && header !== 'Source Provenance',
  );
  const book = XLSX.read(buildMasterImportWorkbook(userHeaders, [], masterImportWorksheets[kind]), {
    type: 'buffer',
  });
  const examples: Record<MasterImportKind, string[]> = {
    seasons: [
      'Season Code: AW26',
      'Season Name: Winter 2026',
      'Barcode Serial: optional integer 1 to 99999; blank stays NULL',
    ],
    sizes: [
      'Size Code: M',
      'Size Label: Medium',
      'Size Type: ALPHA, NUMERIC, AGE, WAIST or FREE_SIZE',
      'Sort Order: required non-negative integer, e.g. 2',
    ],
    hsns: [
      'HSN Code: 01234567 (exactly 8 digits stored as text)',
      'Description: optional approved business description',
      'GST Rule Set Code: optional existing unique ACTIVE code; only ADMIN or ACCOUNTANT may assign it',
    ],
    factories: [
      'Name: Example Factory',
      'Address Line 1: 123 Example Road',
      'Phone: store as text to preserve leading zeroes',
    ],
    distributors: [
      'Name: Example Distributor',
      'GSTIN: 22AAAAA0000A1Z5',
      'Purchase Mode: OUTRIGHT or SALE_RETURN',
    ],
    'retail-stores': [
      'Name: Example Store',
      'Distributor Name / GSTIN / Purchase Mode: identify one ACTIVE parent distributor',
      'Address Line 1, City, State and Postal Code: required',
    ],
  };
  const instructions = [
    ['ERVE MASTER IMPORT INSTRUCTIONS - DO NOT IMPORT'],
    [
      'Enter records only on the ' +
        masterImportWorksheets[kind] +
        ' worksheet, below its unchanged header row.',
    ],
    [
      'This Instructions worksheet contains examples only; never copy these rows into the data worksheet.',
    ],
    [
      'Select the data worksheet when uploading XLSX. Legacy CSV and XLSX headers remain supported.',
    ],
    [
      'Blank rows are ignored. Preview, correct row errors, then confirm eligible records. Existing records are never automatically updated.',
    ],
    ['Keep identifiers, postal codes and phone numbers as text. Do not enter formulas.'],
    ...(kind === 'seasons' || kind === 'sizes' || kind === 'hsns'
      ? [['Status: ACTIVE or INACTIVE; blank defaults to ACTIVE.']]
      : []),
    ...examples[kind].map((example) => [example]),
    ['Examples above are illustrative; confirm business values before importing.'],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(instructions);
  sheet['!cols'] = [{ wch: 125 }];
  XLSX.utils.book_append_sheet(book, sheet, 'Instructions');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const fields: Record<string, string> = {
  'season code': 'code',
  'season name': 'name',
  'barcode serial': 'barcodeSerial',
  'size code': 'code',
  'size label': 'label',
  'size type': 'sizeType',
  'sort order': 'sortOrder',
  'hsn code': 'code',
  'gst rule set code': 'gstRuleSetCode',
  description: 'description',
  name: 'name',
  gstin: 'gstin',
  'purchase mode': 'purchaseMode',
  status: 'status',
  'address line 1': 'addressLine1',
  'address line 2': 'addressLine2',
  city: 'city',
  state: 'state',
  country: 'country',
  'postal code': 'postalCode',
  pin: 'postalCode',
  'contact person': 'contactName',
  'contact name': 'contactName',
  phone: 'contactPhone',
  'contact phone': 'contactPhone',
  email: 'contactEmail',
  'contact email': 'contactEmail',
  'distributor name': 'distributorName',
  'distributor gstin': 'distributorGstin',
  'distributor purchase mode': 'distributorPurchaseMode',
};
const normHeader = (value: unknown) =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
export interface ParsedMasterImportRow {
  rowNumber: number;
  raw: Record<string, string>;
  input: Record<string, string | null>;
  sourceKey?: string;
  error?: string;
}
function readImportWorkbook(buffer: Buffer, fileName: string) {
  if (!buffer.length || buffer.length > 25 * 1024 * 1024)
    throw HttpError.badRequest('Import file must contain between 1 byte and 25 MB');
  if (!/\.(csv|xlsx)$/i.test(fileName)) throw HttpError.badRequest('Use a CSV or XLSX file');
  if (/\.xlsx$/i.test(fileName) && buffer.subarray(0, 2).toString() !== 'PK')
    throw HttpError.badRequest('The XLSX file is not a valid workbook');
  try {
    return XLSX.read(buffer, { type: 'buffer', raw: true });
  } catch {
    throw HttpError.badRequest('Unable to read the import file');
  }
}
export function listMasterImportWorksheets(buffer: Buffer, fileName: string): string[] {
  return /\.csv$/i.test(fileName)
    ? []
    : readImportWorkbook(buffer, fileName).SheetNames.filter(
        (name) => normHeader(name) !== 'instructions',
      );
}
export function parseMasterImportFile(
  kind: MasterImportKind,
  buffer: Buffer,
  fileName: string,
  worksheet?: string,
) {
  const workbook = readImportWorkbook(buffer, fileName);
  const csv = /\.csv$/i.test(fileName);
  if (!csv && !worksheet) throw HttpError.badRequest('Select an explicit worksheet');
  const selected = csv ? workbook.SheetNames[0]! : worksheet!;
  if (normHeader(selected) === 'instructions')
    throw HttpError.badRequest(
      'Instructions worksheets cannot be imported; select the data worksheet',
    );
  const sheet = workbook.Sheets[selected];
  if (!sheet) throw HttpError.badRequest('Selected worksheet does not exist');
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  if (range.e.r > 10000 || range.e.c > 63)
    throw HttpError.badRequest('Import exceeds 10,000 data rows or 64 columns');
  const physical = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 0,
    raw: false,
    defval: '',
    blankrows: true,
  });
  const headers = (physical[0] ?? []).map((cell) => String(cell).trim());
  if (headers.some((header) => header.includes('ERVE MASTER IMPORT INSTRUCTIONS')))
    throw HttpError.badRequest('Instruction rows cannot be imported; select the data worksheet');
  const normalizedHeaders = headers.map(normHeader);
  const semantic = normalizedHeaders
    .filter(Boolean)
    .map((header) => (Object.hasOwn(fields, header) ? fields[header] : header));
  if (new Set(semantic).size !== semantic.length)
    throw HttpError.badRequest('Duplicate import headers');
  if (
    kind === 'hsns' &&
    normalizedHeaders.some(
      (header) => header !== 'gst rule set code' && /gst|rule.?set/i.test(header),
    )
  )
    throw HttpError.badRequest(
      'Only GST Rule Set Code is supported for HSN assignment; remove other GST configuration columns',
    );
  const required =
    kind === 'seasons'
      ? ['season code', 'season name']
      : kind === 'sizes'
        ? ['size code', 'size label', 'size type', 'sort order']
        : kind === 'hsns'
          ? ['hsn code']
          : kind === 'factories'
            ? ['name']
            : kind === 'distributors'
              ? ['name', 'gstin']
              : ['name', 'address line 1', 'city', 'state', 'postal code'];
  for (const header of required)
    if (!normalizedHeaders.includes(header))
      throw HttpError.badRequest(`Missing required header: ${header === 'name' ? 'Name' : header}`);
  const rows: ParsedMasterImportRow[] = [];
  for (const [index, cells] of physical.slice(1).entries()) {
    const errorCell = headers.some(
      (_, column) => sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })]?.t === 'e',
    );
    if (!errorCell && !cells.some((value) => String(value ?? '').trim())) continue;
    const raw: Record<string, string> = Object.create(null);
    const input: Record<string, string | null> = Object.create(null);
    let sourceKey: string | undefined;
    let error: string | undefined;
    for (const [column, header] of headers.entries()) {
      if (!header) continue;
      const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
      const value =
        cell?.t === 'e' ? String(cell.w ?? `Excel error ${cell.v}`) : String(cells[column] ?? '');
      raw[header] = value;
      const normalized = normalizedHeaders[column]!;
      const field = Object.hasOwn(fields, normalized) ? fields[normalized] : undefined;
      if (field && value.trim()) input[field] = value.trim();
      if (kind === 'hsns' && normalized === 'hsn code' && cell?.t === 'n') {
        const literal = String(cell.v);
        if (!/^\d{8}$/.test(literal))
          error =
            'HSN numeric cell may have lost leading zeroes; correct the source to exactly 8 digits stored as text';
        input.code = literal;
      }
      if (normalized === 'source key' && value.trim()) sourceKey = value.trim();
      if (sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })]?.t === 'e')
        error = `Review cached Excel error in ${header}`;
      if (value.length > 32767)
        error = `Value in ${header} exceeds Excel's text-cell limit; preserve full evidence separately`;
    }
    rows.push({
      rowNumber: index + 2,
      raw,
      input,
      ...(sourceKey ? { sourceKey } : {}),
      ...(error ? { error } : {}),
    });
  }
  return { rows, headers, worksheet: csv ? '' : selected };
}
export function buildMasterImportWorkbook(
  headers: string[],
  rows: string[][],
  worksheet: string,
): Buffer {
  const book = XLSX.utils.book_new();
  const literal = (value: string) => ({
    t: 's',
    v:
      value.length <= 32767
        ? value
        : 'Full oversized value is available in the import run JSON detail.',
  });
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([headers, ...rows].map((row) => row.map(literal))),
    worksheet,
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
