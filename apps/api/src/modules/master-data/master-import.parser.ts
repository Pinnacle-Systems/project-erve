import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import type { MasterImportKind } from '@erve/types';
import { HttpError } from '../../errors/http-error.js';
import {
  addDataWorksheet,
  addInstructionsWorksheet,
  type ImportFieldDoc,
  type ImportInstructionsContent,
} from './import-instructions-sheet.js';

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
const commonFieldDocs = (field: (header: string) => ImportFieldDoc | undefined) =>
  common.map(field).filter((doc): doc is ImportFieldDoc => Boolean(doc));

const contactFieldDocs: Record<string, ImportFieldDoc> = {
  'Address Line 1': {
    name: 'Address Line 1',
    description: 'First line of the street address.',
    required: false,
    dataType: 'Text',
    example: '123 Industrial Estate Road',
    validation: 'No format restriction.',
  },
  'Address Line 2': {
    name: 'Address Line 2',
    description: 'Second line of the street address, if needed.',
    required: false,
    dataType: 'Text',
    example: 'Phase 2',
    validation: 'No format restriction.',
  },
  City: { name: 'City', description: 'City or town.', required: false, dataType: 'Text', example: 'Tiruppur', validation: 'No format restriction.' },
  State: { name: 'State', description: 'State or province.', required: false, dataType: 'Text', example: 'Tamil Nadu', validation: 'No format restriction.' },
  Country: { name: 'Country', description: 'Country.', required: false, dataType: 'Text', example: 'India', validation: 'No format restriction.' },
  'Postal Code': {
    name: 'Postal Code',
    description: 'PIN/postal code.',
    required: false,
    dataType: 'Text',
    example: '641604',
    validation: 'No format restriction.',
    notes: 'Format the column as Text before typing so leading zeroes are preserved.',
  },
  'Contact Person': {
    name: 'Contact Person',
    description: 'Name of a contact person at this address.',
    required: false,
    dataType: 'Text',
    example: 'Example Contact',
    validation: 'No format restriction.',
    notes: 'Illustrative only; use a real contact name only with that person’s consent.',
  },
  Phone: {
    name: 'Phone',
    description: 'Contact phone number.',
    required: false,
    dataType: 'Text',
    example: '9876543210',
    validation: 'No format restriction.',
    notes: 'Format the column as Text before typing so a leading "+" or "0" is preserved.',
  },
  Email: {
    name: 'Email',
    description: 'Contact email address.',
    required: false,
    dataType: 'Text (email)',
    example: 'contact@example.com',
    validation: 'Must be a valid email address if supplied.',
  },
};

const masterImportFieldDocs: Record<MasterImportKind, ImportFieldDoc[]> = {
  seasons: [
    {
      name: 'Season Code',
      description: 'Unique business code for this Season, used across Styles, barcodes and reporting.',
      required: true,
      dataType: 'Text, letters/numbers/hyphen/slash only, max 20 characters',
      example: 'AW27',
      validation:
        'Must be globally unique (case-insensitive); automatically converted to uppercase. An existing Season with the same code is never overwritten — a different Season Name or Barcode Serial for the same code is routed to review.',
      notes: 'Financial Year is not part of Season identity and is not a template column.',
    },
    {
      name: 'Season Name',
      description: 'Display name shown throughout the application for this Season.',
      required: true,
      dataType: 'Text, max 80 characters',
      example: 'Autumn-Winter 2027',
      validation: 'Free text.',
    },
    {
      name: 'Barcode Serial',
      description: 'Stable numeric prefix used by the automatic Style barcode generator for this Season.',
      required: false,
      dataType: 'Whole number, 1–99999',
      example: '27',
      validation: 'Must be a positive integer up to 99999 and not already used by a different Season.',
      notes:
        'Blank leaves this NULL. Automatic Style barcode generation for this Season’s Styles may require a Barcode Serial — supply one if you plan to rely on it.',
    },
    {
      name: 'Status',
      description: 'Whether this Season is available for use.',
      required: false,
      dataType: 'ACTIVE or INACTIVE',
      example: 'ACTIVE',
      validation: 'Must be exactly ACTIVE or INACTIVE.',
      notes: 'Blank defaults to ACTIVE.',
    },
  ],
  sizes: [
    {
      name: 'Size Code',
      description: 'Unique business code identifying this Size — the sole identity used to match existing Sizes.',
      required: true,
      dataType: 'Text',
      example: 'M',
      validation:
        'Must be unique (case-insensitive) across all Sizes. A matching code with a different Label, Size Type or Sort Order is routed to review rather than updated.',
      notes: 'Also used for AGE-type sizes, e.g. "3" for "3 Years".',
    },
    {
      name: 'Size Label',
      description: 'Display label for this Size.',
      required: true,
      dataType: 'Text',
      example: 'Medium',
      validation: 'Free text.',
    },
    {
      name: 'Size Type',
      description: 'Category of sizing this Size belongs to.',
      required: true,
      dataType: 'One of: AGE, ALPHA, NUMERIC, WAIST, FREE_SIZE',
      example: 'ALPHA',
      validation: 'Must exactly match one of the five allowed values (case-sensitive, all uppercase).',
    },
    {
      name: 'Sort Order',
      description: 'Determines display ordering among Sizes of the same type.',
      required: true,
      dataType: 'Whole number',
      example: '2',
      validation: 'Required; must be a whole number.',
    },
    {
      name: 'Status',
      description: 'Whether this Size is available for use.',
      required: false,
      dataType: 'ACTIVE or INACTIVE',
      example: 'ACTIVE',
      validation: 'Must be exactly ACTIVE or INACTIVE.',
      notes: 'Blank defaults to ACTIVE.',
    },
  ],
  hsns: [
    {
      name: 'HSN Code',
      description: 'The HSN/SAC classification code for this master record.',
      required: true,
      dataType: 'Text, exactly 8 digits',
      example: '61091000',
      validation: 'Must be exactly 8 numeric digits and globally unique.',
      notes:
        'Format the column as Text (or prefix the value with an apostrophe) before typing so a leading zero is not dropped — the importer rejects a numeric cell that no longer prints as 8 digits.',
    },
    {
      name: 'Description',
      description: 'Business-maintained description of this HSN Code.',
      required: false,
      dataType: 'Text',
      example: '',
      validation: 'Free text.',
      notes:
        'This is a business-maintained label, not an official government HSN/SAC description — Erve does not verify it against a tariff database. Leave blank rather than inventing a description if none is confirmed.',
    },
    {
      name: 'Status',
      description: 'Whether this HSN Code is available for use.',
      required: false,
      dataType: 'ACTIVE or INACTIVE',
      example: 'ACTIVE',
      validation: 'Must be exactly ACTIVE or INACTIVE.',
      notes: 'Blank defaults to ACTIVE.',
    },
    {
      name: 'GST Rule Set Code',
      description: 'Associates this HSN with a GST Rule Set configured in GST Compliance settings.',
      required: false,
      dataType: 'Text, matching an existing GST Rule Set Code',
      example: 'GST-12-STD',
      validation:
        'Must exactly match (case-insensitive) one existing ACTIVE GST Rule Set Code. Assigning or changing this value requires the ADMIN or ACCOUNTANT role.',
      notes:
        'Illustrative example only — confirm the real code in GST Compliance settings; this importer never fabricates or guesses a rule set. Leaving this blank never clears an existing assignment.',
    },
  ],
  factories: [
    {
      name: 'Name',
      description: 'The factory’s business name — the sole identity used to match existing Factories.',
      required: true,
      dataType: 'Text',
      example: 'Example Garments Pvt Ltd',
      validation: 'Must be unique (case/whitespace-insensitive). A matching name with different address fields is routed to review rather than updated.',
      notes: 'Illustrative only. New Factories are always created with Status ACTIVE; deactivate one later from the Factory Master screen.',
    },
    ...commonFieldDocs((header) => contactFieldDocs[header]),
  ],
  distributors: [
    {
      name: 'Name',
      description: 'The distributor’s business name. Together with Purchase Mode, this identifies the Distributor for matching.',
      required: true,
      dataType: 'Text',
      example: 'Example Distributors Pvt Ltd',
      validation: 'A matching Name and Purchase Mode with different address fields is routed to review rather than updated.',
      notes: 'Illustrative only.',
    },
    {
      name: 'GSTIN',
      description: 'The distributor’s GST registration number.',
      required: true,
      dataType: '15 characters: 2-digit state code + 5 letters + 4 digits + 1 letter + 1 alphanumeric + "Z" + 1 alphanumeric checksum',
      example: '27AAAAA0000A1Z5',
      validation: 'Must match the standard GSTIN pattern (structural check only, not government verification); automatically converted to uppercase.',
      notes: 'Illustrative format only; not a real registration number.',
    },
    {
      name: 'Purchase Mode',
      description: 'Whether goods are purchased outright or on a sale-or-return basis from this Distributor.',
      required: true,
      dataType: 'OUTRIGHT or SALE_RETURN',
      example: 'OUTRIGHT',
      validation: 'Must be exactly OUTRIGHT or SALE_RETURN. A blank or unrecognized value holds the row for review rather than rejecting it outright.',
      notes: 'Immutable once a Distributor exists — this import cannot change Purchase Mode on an existing record.',
    },
    ...commonFieldDocs((header) => contactFieldDocs[header]),
  ],
  'retail-stores': [
    {
      name: 'Distributor Name',
      description: 'Name of the parent Distributor this Retail Store belongs to.',
      required: false,
      dataType: 'Text',
      example: 'Example Distributors Pvt Ltd',
      validation: 'Must match exactly one existing ACTIVE Distributor by normalized name. Required unless Distributor GSTIN is supplied instead.',
      notes: 'Illustrative only.',
    },
    {
      name: 'Distributor GSTIN',
      description: 'GSTIN of the parent Distributor, used to identify or disambiguate it.',
      required: false,
      dataType: '15-character GSTIN',
      example: '27AAAAA0000A1Z5',
      validation: 'Must match exactly one existing ACTIVE Distributor. Required unless Distributor Name is supplied instead.',
      notes: 'Illustrative format only.',
    },
    {
      name: 'Distributor Purchase Mode',
      description: 'Used only to disambiguate when a Distributor Name matches more than one Distributor.',
      required: false,
      dataType: 'OUTRIGHT or SALE_RETURN',
      example: 'OUTRIGHT',
      validation: 'Must be exactly OUTRIGHT or SALE_RETURN when supplied.',
      notes: 'Illustrative only; matches the Distributor Master Import template’s own Purchase Mode example.',
    },
    {
      name: 'Name',
      description: 'The Retail Store’s own name.',
      required: true,
      dataType: 'Text',
      example: 'Example Retail Store',
      validation: 'Free text.',
    },
    ...commonFieldDocs((header) => contactFieldDocs[header] && (header === 'Address Line 1' || header === 'City' || header === 'State' || header === 'Postal Code')
      ? { ...contactFieldDocs[header]!, required: true }
      : contactFieldDocs[header]),
    {
      name: 'GSTIN',
      description: 'This Retail Store’s own GST registration number (distinct from the Distributor’s GSTIN above).',
      required: false,
      dataType: '15-character GSTIN',
      example: '08AAAAA0000A1Z5',
      validation: 'Must match the standard GSTIN pattern if supplied.',
      notes: 'Illustrative format only.',
    },
  ],
};
const masterImportSummary: Record<MasterImportKind, { moduleName: string; summary: string; purpose: string }> = {
  seasons: {
    moduleName: 'Season Master Import',
    summary: 'Creates new Season master records used to classify Styles and drive automatic barcode generation.',
    purpose: 'Bulk-create Seasons ahead of onboarding a new collection, instead of adding them one at a time.',
  },
  sizes: {
    moduleName: 'Size Master Import',
    summary: 'Creates new Size master records used across Styles, Order Sheets and Job Orders.',
    purpose: 'Bulk-create the Size range (e.g. a new ALPHA or AGE range) in one upload.',
  },
  hsns: {
    moduleName: 'HSN/SAC Master Import',
    summary: 'Creates new HSN/SAC master records, optionally associated with a GST Rule Set.',
    purpose: 'Bulk-create HSN Codes referenced by Styles and tax documents.',
  },
  factories: {
    moduleName: 'Factory Master Import',
    summary: 'Creates new Factory master records used for Job Orders and factory pricing.',
    purpose: 'Bulk-create Factories instead of adding each one individually.',
  },
  distributors: {
    moduleName: 'Distributor Master Import',
    summary: 'Creates new Distributor master records used for Sale Orders, Dispatch and billing.',
    purpose: 'Bulk-create Distributors instead of adding each one individually.',
  },
  'retail-stores': {
    moduleName: 'Retail Store Master Import',
    summary: 'Creates new Retail Store master records, each linked to an existing Distributor.',
    purpose: 'Bulk-create the Retail Stores belonging to one or more existing Distributors.',
  },
};
function masterImportInstructionsContent(kind: MasterImportKind): ImportInstructionsContent {
  const { moduleName, summary, purpose } = masterImportSummary[kind];
  return {
    moduleName,
    summary,
    purpose,
    dataWorksheetName: masterImportWorksheets[kind],
    usageNotes: [
      'Legacy CSV and XLSX headers remain supported; this import never removes a previously used Source Key or Source Provenance column.',
      'Blank rows are ignored. Preview the file, correct any row errors, then confirm the eligible records — existing master records are never automatically updated.',
      'Keep identifiers, postal codes and phone numbers formatted as Text. Do not enter formulas.',
      'Files may contain up to 10,000 data rows and 64 columns.',
    ],
    fields: masterImportFieldDocs[kind],
  };
}
/** Downloadable templates contain business fields only. Older imports with explicit
 * source keys/provenance remain accepted so historical data is not disrupted. */
export async function buildMasterImportTemplate(kind: MasterImportKind): Promise<Buffer> {
  const userHeaders = masterImportHeaders[kind].filter(
    (header) => header !== 'Source Key' && header !== 'Source Provenance',
  );
  const workbook = new ExcelJS.Workbook();
  addDataWorksheet(workbook, masterImportWorksheets[kind], userHeaders);
  addInstructionsWorksheet(workbook, masterImportInstructionsContent(kind));
  return Buffer.from(await workbook.xlsx.writeBuffer());
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
