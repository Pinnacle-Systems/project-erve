// DEMO-001: generic, create-only, idempotent bulk Style import. A thin
// orchestration layer over the EXISTING, already-concurrency-safe service
// functions (`createStyle`, `uploadStyleImage`) — this module never
// reimplements Style/barcode/image business logic, only decides WHICH rows
// are safe to create, skip, or recover, and records the provenance that
// makes a later retry safe.
//
// Expected workbook columns (header names case-insensitive, any order):
//   Style Number   (required)
//   Style Name     (required)
//   Final MRP      (required, > 0)
//   Season Code    (required)
//   Size Codes     (required, comma-separated, e.g. "S,M,L")
//   LMIX Number    (optional — the existing barcode generator needs either
//                   an explicit Barcode per Size or a valid LMIX Number
//                   ("LMIX<digits>") to auto-generate one; required only if
//                   any Size's Barcode is left blank)
//   HSN Code       (optional — a blank cell or an entirely missing column
//                   means "no HSN yet", exactly as if this column didn't
//                   exist; a non-blank value must resolve to an ACTIVE Hsn
//                   or the row is rejected. Seasons with no HSN source
//                   available at all, e.g. AW26, simply omit this column or
//                   leave it blank and import unaffected — see UNKNOWN_HSN/
//                   INACTIVE_HSN below for the only HSN-related rejection)
//   Barcodes       (optional, comma-separated, parallel to Size Codes —
//                   a blank entry means "generate"; omit the column
//                   entirely to generate every barcode)
//   Factory Mappings (optional, semicolon-separated CODE:PRICE pairs, e.g.
//                      "CLIFTON:450.00;GREEN_WAY:460.00")
//   Royalty %      (optional — a plain numeric cell showing 7.5 and a
//                   genuinely Excel "Percentage"-formatted cell showing 7.5%
//                   (internally stored as the fraction 0.075) both resolve to
//                   7.5; blank or an entirely missing column means "no
//                   royalty set", never a rejection. Must be 0-100 inclusive
//                   when supplied — see resolveRoyaltyPercentageCell below.)
// Primary Style images are PNGs embedded directly in the workbook, anchored
// to their Style's row (see xlsx-embedded-images.ts) — not a column.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import { prisma, type Prisma } from '../../db/prisma.js';
import { currentUserSelect, toCurrentUser, type CurrentUser } from '../../auth/current-user.js';
import { HttpError } from '../../errors/http-error.js';
import { getFileStorage } from '../../storage/index.js';
import {
  extractNormalizedEmbeddedImagesByRow,
  type EmbeddedImage,
  type EmbeddedImageAmbiguity,
} from '../../cli/xlsx-embedded-images.js';
import { createStyle, validateStyleCreate, styleCommittedDespiteError, type StyleFactoryMappingRequest, type StyleSizeRequest } from './master-data.service.js';
import { stageStyleImage, attachStagedStyleImage, discardStagedStyleImage, validateImageUpload, type StagedStyleImage } from './style-images.service.js';

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function norm(value: string): string {
  return value.trim().toUpperCase();
}

function splitList(value: string, separator = ','): string[] {
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Barcodes are positional against Size Codes (a blank entry means "generate
// for this specific size") — unlike splitList, blank entries must be kept,
// not dropped, or a later barcode would silently shift onto the wrong size.
function splitPositionalList(value: string, separator = ','): string[] {
  if (value === '') return [];
  return value.split(separator).map((entry) => entry.trim());
}

// ---------------------------------------------------------------------------
// Sheet parsing (text columns only — embedded images are read separately by
// xlsx-embedded-images.ts and joined back in by row number below).
// ---------------------------------------------------------------------------

export interface BulkStyleImportSheetRow {
  rowNumber: number;
  styleNumber: string;
  styleName: string;
  description?: string;
  categoryDescription?: string;
  ipName?: string;
  licensor?: string;
  colour?: string;
  finalMrpRaw: string;
  seasonCode: string;
  financialYear: string;
  // Optional. The existing barcode generator (barcode.util.ts, unchanged)
  // requires either an explicit barcode per Size or a Style LMIX Number in
  // the form "LMIX<digits>" to auto-generate one — this column exists so a
  // bulk-imported Style can use auto-generation too, not just a supplied
  // barcode per Size.
  lmixNumber: string;
  // Optional. Blank (or the column missing entirely) means "no HSN yet" —
  // never a rejection. A non-blank value must resolve to an ACTIVE Hsn.
  hsnCode: string;
  // Optional, with THREE distinct states (never a rejection by itself):
  //   undefined — the Royalty % column is entirely absent from this
  //                workbook (an old workbook predating this feature); "not
  //                specified", must never be asserted or compared against
  //                an existing Style's stored value.
  //   null       — the column is present but this row's cell is blank; an
  //                explicit "no royalty" that DOES get written and DOES
  //                participate in existing-Style conflict comparison.
  //   NaN        — the column is present and this row's cell has content
  //                that isn't a valid number (row-level rejection).
  //   a number   — the column is present with a resolved value, already
  //                converted out of an Excel Percentage-format fraction
  //                (see resolveRoyaltyPercentageCell) but NOT YET rounded
  //                or range-checked — planBulkStyleImport validates the
  //                raw value against 0-100 before rounding for storage, so
  //                an out-of-range value isn't masked by rounding first.
  // royaltyPercentageRaw carries the display text for error messages only
  // ('' for both the undefined and null states).
  royaltyPercentageRaw: string;
  royaltyPercentage: number | null | undefined;
  sizeCodes: string[];
  barcodes: string[];
  factoryMappings: Array<{ factoryCode: string; priceRaw: string }>;
  factoryNameMappings: Array<{ factoryName: string; priceRaw: string }>;
}

const SHEET_HEADERS: Record<
  string,
  keyof Omit<BulkStyleImportSheetRow, 'rowNumber' | 'sizeCodes' | 'barcodes' | 'factoryMappings' | 'factoryNameMappings'>
> = {
  'style number': 'styleNumber',
  'style name': 'styleName',
  description: 'description',
  category: 'categoryDescription',
  'ip name': 'ipName',
  licensor: 'licensor',
  colour: 'colour',
  'final mrp': 'finalMrpRaw',
  'season code': 'seasonCode',
  'financial year': 'financialYear',
  'lmix number': 'lmixNumber',
  'hsn code': 'hsnCode',
};

export function listBulkStyleImportWorksheets(buffer: Buffer): string[] {
  return XLSX.read(buffer, { type: 'buffer' }).SheetNames;
}

const styleMetadataFields = ['description', 'categoryDescription', 'ipName', 'licensor', 'colour'] as const;

// Royalty % cannot go through the plain string SHEET_HEADERS pipeline below
// (same as Size Codes/Barcodes/Factory Mappings) because a genuinely
// Excel-"Percentage"-formatted numeric cell stores its RAW value as a
// fraction (0.075) while DISPLAYING "7.50%" — the formatted text SHEET_HEADERS
// would otherwise capture is lossy (e.g. a "0%" format rounds display to a
// whole percent) and can't be reliably reversed. Reading the cell object
// directly (raw value + its number-format string) is the only way to recover
// the true percentage-points value for both a plain numeric cell (7.5) and a
// percentage-formatted one (0.075 displayed as 7.5%) — both must resolve to
// the same 7.5. Requires XLSX.read's `cellNF: true` below, which populates
// `.z` (the cell's number format string) on each parsed cell.
//
// Deliberately returns the RAW, unrounded resolved value — rounding to 2
// decimal places happens only in planBulkStyleImport, AFTER range validation
// passes, so an out-of-range input (e.g. -0.001 or 100.001) can't be masked
// by rounding into apparent validity (e.g. -0.001 rounding to -0/0, or
// 100.001 rounding to 100.00) before the 0-100 check ever sees it.
//
// `column < 0` (the header itself is missing from this workbook) is
// distinct from "this row's cell is blank" — see BulkStyleImportSheetRow's
// royaltyPercentage doc comment for why that distinction matters.
function resolveRoyaltyPercentageCell(sheet: XLSX.WorkSheet, sheetRowIndex: number, column: number): { raw: string; value: number | null | undefined } {
  if (column < 0) return { raw: '', value: undefined };
  const cell: XLSX.CellObject | undefined = sheet[XLSX.utils.encode_cell({ r: sheetRowIndex, c: column })];
  if (!cell || cell.v === undefined || cell.v === null || cell.v === '') return { raw: '', value: null };
  if (cell.t === 'n') {
    const numeric = typeof cell.v === 'number' ? cell.v : Number(cell.v);
    const isPercentFormat = typeof cell.z === 'string' && cell.z.includes('%');
    const resolved = isPercentFormat ? numeric * 100 : numeric;
    return { raw: cell.w !== undefined ? String(cell.w) : String(cell.v), value: Number.isFinite(resolved) ? resolved : NaN };
  }
  const text = String(cell.v).trim();
  if (text === '') return { raw: '', value: null };
  const parsed = Number(text);
  return { raw: text, value: Number.isFinite(parsed) ? parsed : NaN };
}

export function parseBulkStyleImportSheet(buffer: Buffer, worksheet?: string): BulkStyleImportSheetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true, cellNF: true });
  const sheet = workbook.Sheets[worksheet ?? workbook.SheetNames[0]!];
  if (!sheet) throw new Error(`Worksheet "${worksheet ?? ''}" does not exist`);
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, raw: false, defval: '', blankrows: true });
  const headerCells = (raw[0] ?? []).map((cell) => String(cell).trim().toLowerCase());

  const required = ['style number', 'style name', 'final mrp', 'season code', 'size codes'];
  for (const column of required) {
    if (!headerCells.includes(column)) {
      throw new Error(`Header row must include "${column}"`);
    }
  }
  const sizeCodesColumn = headerCells.indexOf('size codes');
  const barcodesColumn = headerCells.indexOf('barcodes');
  const factoryMappingsColumn = headerCells.indexOf('factory mappings');
  const factoryNamesColumn = headerCells.indexOf('factory name mappings');
  const royaltyColumn = headerCells.indexOf('royalty %');

  return raw.slice(1).map((cells, index) => {
    const row: Record<string, string> = {};
    headerCells.forEach((headerCell, column) => {
      const key = SHEET_HEADERS[headerCell];
      if (key) row[key] = String(cells[column] ?? '').trim();
    });
    const metadata: Partial<Pick<BulkStyleImportSheetRow, (typeof styleMetadataFields)[number]>> = {};
    for (const field of styleMetadataFields) if (Object.hasOwn(row, field)) metadata[field] = row[field];
    const royaltyCell = resolveRoyaltyPercentageCell(sheet, index + 1, royaltyColumn);
    return {
      ...metadata,
      rowNumber: index + 2,
      styleNumber: row.styleNumber ?? '',
      styleName: row.styleName ?? '',
      finalMrpRaw: row.finalMrpRaw ?? '',
      seasonCode: row.seasonCode ?? '',
      financialYear: row.financialYear ?? '',
      lmixNumber: row.lmixNumber ?? '',
      hsnCode: row.hsnCode ?? '',
      royaltyPercentageRaw: royaltyCell.raw,
      royaltyPercentage: royaltyCell.value,
      sizeCodes: splitList(String(cells[sizeCodesColumn] ?? '')),
      barcodes: barcodesColumn >= 0 ? splitPositionalList(String(cells[barcodesColumn] ?? '')) : [],
      factoryMappings:
        factoryMappingsColumn >= 0
          ? splitList(String(cells[factoryMappingsColumn] ?? ''), ';')
              .map((pair) => {
                const separator = pair.lastIndexOf(':');
                const factoryCode = separator < 0 ? pair : pair.slice(0, separator);
                const priceRaw = separator < 0 ? '' : pair.slice(separator + 1);
                return { factoryCode: (factoryCode ?? '').trim(), priceRaw: (priceRaw ?? '').trim() };
              })
              .filter((mapping) => mapping.factoryCode)
          : [],
      factoryNameMappings: factoryNamesColumn >= 0
        ? splitList(String(cells[factoryNamesColumn] ?? ''), ';').map((pair) => {
            const separator = pair.lastIndexOf(':');
            return { factoryName: separator < 0 ? pair : pair.slice(0, separator).trim(), priceRaw: separator < 0 ? '' : pair.slice(separator + 1).trim() };
          }) : [],
    };
  }).filter((row) => row.styleNumber || row.styleName || row.finalMrpRaw || row.seasonCode || row.sizeCodes.length || row.lmixNumber || row.hsnCode || row.barcodes.length || row.factoryMappings.length || row.factoryNameMappings.length || row.financialYear || row.royaltyPercentageRaw);
}

// ---------------------------------------------------------------------------
// Planning (read-only: validates against the DB, never writes).
// ---------------------------------------------------------------------------

export type BulkStyleImportRejectionReason =
  | 'EXISTING_STYLE_CONFLICT'
  | 'DUPLICATE_STYLE_NUMBER_IN_FILE'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_FINAL_MRP'
  | 'UNKNOWN_SEASON'
  | 'INACTIVE_SEASON'
  | 'UNKNOWN_SIZE'
  | 'INACTIVE_SIZE'
  | 'UNKNOWN_FACTORY'
  | 'INACTIVE_FACTORY'
  | 'INVALID_FACTORY_PRICE'
  | 'UNKNOWN_HSN'
  | 'INACTIVE_HSN'
  | 'INVALID_ROYALTY_PERCENTAGE'
  | 'SIZE_BARCODE_COUNT_MISMATCH'
  | 'AMBIGUOUS_IMAGE_ANCHOR'
  | 'AMBIGUOUS_SEASON'
  | 'AMBIGUOUS_FACTORY'
  | 'DOMAIN_VALIDATION_FAILED'
  | 'DUPLICATE_BARCODE_IN_FILE'
  | 'IMAGE_PROVENANCE_MISMATCH';

export type BulkStyleImportRowStatus = 'CREATE' | 'SKIP_EXISTING' | 'RESUME_IMAGE_PENDING' | 'REJECTED';

export interface BulkStyleImportCreateFields {
  styleName: string;
  description?: string | null;
  categoryDescription?: string | null;
  ipName?: string | null;
  licensor?: string | null;
  colour?: string | null;
  finalMrp: number;
  // Three states, mirroring hsnId's undefined-vs-null distinction below:
  // undefined means "the Royalty % column is entirely absent from this
  // workbook" — not specified, the key is left out of the object passed to
  // createStyle (a no-op there, same as before this column existed) and
  // never compared against an existing Style's stored value in
  // existingStyleConflict. null means "the column is present but this
  // row's cell is blank" — an explicit, comparable "no royalty". A number
  // means a validated, already-rounded-to-2-decimals value.
  royaltyPercentage?: number | null;
  seasonId: string;
  lmixNumber: string | null;
  // Absent (undefined) means "no HSN Code supplied" — the key is left out of
  // the object passed to createStyle entirely, which is a no-op there (same
  // as a Style created today, before this column existed). Never coerced to
  // null, since createStyle treats an explicit null as "unassign" on update
  // paths — undefined is the correct "not specified" for a create.
  hsnId?: string;
  sizes: StyleSizeRequest[];
  factoryMappings: StyleFactoryMappingRequest[];
  images: EmbeddedImage[];
}

export interface BulkStyleImportPlanRow {
  rowNumber: number;
  styleNumber: string;
  status: BulkStyleImportRowStatus;
  reason?: BulkStyleImportRejectionReason;
  detail?: string;
  imageCount: number;
  create?: BulkStyleImportCreateFields;
  existingStyleId?: string;
}

export interface BulkStyleImportPlan {
  worksheet?: string;
  sourceFileChecksum: string;
  totalRows: number;
  rows: BulkStyleImportPlanRow[];
  /** Embedded-image problems that couldn't be attributed to any specific row (e.g. an unparseable anchor) — reported, never silently dropped, but don't by themselves reject a row. */
  fileLevelImageWarnings: EmbeddedImageAmbiguity[];
}

export async function planBulkStyleImport(buffer: Buffer, worksheet?: string): Promise<BulkStyleImportPlan> {
  const sourceFileChecksum = sha256Hex(buffer);
  const selectedWorksheet = worksheet ?? listBulkStyleImportWorksheets(buffer)[0];
  const sheetRows = parseBulkStyleImportSheet(buffer, selectedWorksheet);
  const { imagesByRow, ambiguous, imageMetadataPresent } = await extractNormalizedEmbeddedImagesByRow(buffer, selectedWorksheet);
  if (imageMetadataPresent && imagesByRow.size === 0)
    throw HttpError.badRequest(`Workbook image metadata was detected but no valid images could be extracted. ${ambiguous.map(a => a.detail).join('; ')}`);
  const ambiguousByRow = new Map(ambiguous.filter((a) => a.rowNumber !== undefined).map((a) => [a.rowNumber!, a]));
  const fileLevelImageWarnings = ambiguous.filter((a) => a.rowNumber === undefined);
  const physicalRows = new Set(sheetRows.map((row) => row.rowNumber));
  for (const rowNumber of imagesByRow.keys()) {
    if (!physicalRows.has(rowNumber)) fileLevelImageWarnings.push({ reason: 'ORPHAN_IMAGE_ANCHOR', detail: `An image is anchored to row ${rowNumber}, which has no Style record` });
  }

  const [seasons, sizes, factories, hsns, existingStyles] = await Promise.all([
    prisma.season.findMany({ select: { id: true, code: true, status: true, financialYear: { select: { code: true } } } }),
    prisma.size.findMany({ select: { id: true, code: true, status: true } }),
    prisma.factory.findMany({ select: { id: true, code: true, name: true, status: true } }),
    prisma.hsn.findMany({ select: { id: true, code: true, status: true } }),
    prisma.style.findMany({ select: { id: true, styleNumber: true } }),
  ]);
  const sizeByCode = new Map(sizes.map((s) => [norm(s.code), s]));
  const factoryByCode = new Map(factories.map((f) => [norm(f.code), f]));
  const hsnByCode = new Map(hsns.map((h) => [norm(h.code), h]));
  const existingStyleIdByNumber = new Map(existingStyles.map((s) => [s.styleNumber, s.id]));

  const rows: BulkStyleImportPlanRow[] = [];
  const seenStyleNumbers = new Set<string>();
  const seenBarcodes = new Map<string, number>();

  for (const sheetRow of sheetRows) {
    const rowImages = imagesByRow.get(sheetRow.rowNumber) ?? [];
    const imageCount = rowImages.length;

    const reject = (reason: BulkStyleImportRejectionReason, detail: string): void => {
      rows.push({ rowNumber: sheetRow.rowNumber, styleNumber: sheetRow.styleNumber, status: 'REJECTED', reason, detail, imageCount });
    };

    if (sheetRow.styleNumber && seenStyleNumbers.has(sheetRow.styleNumber)) {
      reject('DUPLICATE_STYLE_NUMBER_IN_FILE', `Style Number "${sheetRow.styleNumber}" appears more than once in this file`);
      continue;
    }
    if (sheetRow.styleNumber) seenStyleNumbers.add(sheetRow.styleNumber);

    if (!sheetRow.styleNumber || !sheetRow.styleName || !sheetRow.finalMrpRaw || !sheetRow.seasonCode || sheetRow.sizeCodes.length === 0) {
      reject('MISSING_REQUIRED_FIELD', 'Style Number, Style Name, Final MRP, Season Code and at least one Size Code are all required');
      continue;
    }

    const finalMrp = Number(sheetRow.finalMrpRaw);
    if (!Number.isFinite(finalMrp) || finalMrp <= 0) {
      reject('INVALID_FINAL_MRP', `"${sheetRow.finalMrpRaw}" is not a valid positive MRP`);
      continue;
    }

    // Royalty % has three states (see BulkStyleImportSheetRow's doc comment):
    // undefined (column entirely absent from this workbook) stays
    // undefined — "not specified", never asserted and never compared
    // against an existing Style below. null (column present, cell blank)
    // stays an explicit null. Anything else must be a finite RAW number in
    // 0-100 inclusive, validated BEFORE rounding for storage — so e.g. a
    // raw -0.001 or 100.001 is rejected even though its rounded form
    // (-0/0 or 100.00) would otherwise appear in-range.
    let royaltyPercentage: number | null | undefined = sheetRow.royaltyPercentage === undefined ? undefined : null;
    if (sheetRow.royaltyPercentage !== undefined && sheetRow.royaltyPercentage !== null) {
      if (!Number.isFinite(sheetRow.royaltyPercentage)) {
        reject('INVALID_ROYALTY_PERCENTAGE', `"${sheetRow.royaltyPercentageRaw}" is not a valid Royalty %`);
        continue;
      }
      if (sheetRow.royaltyPercentage < 0 || sheetRow.royaltyPercentage > 100) {
        reject('INVALID_ROYALTY_PERCENTAGE', `Royalty % "${sheetRow.royaltyPercentageRaw}" must be between 0 and 100`);
        continue;
      }
      royaltyPercentage = Math.round(sheetRow.royaltyPercentage * 100) / 100;
    }

    const matchingSeasons = seasons.filter((s) => norm(s.code) === norm(sheetRow.seasonCode) && (!sheetRow.financialYear || norm(s.financialYear.code) === norm(sheetRow.financialYear)));
    if (matchingSeasons.length > 1) {
      reject('AMBIGUOUS_SEASON', `Season "${sheetRow.seasonCode}" exists in multiple Financial Years; supply Financial Year`);
      continue;
    }
    const season = matchingSeasons[0];
    if (!season) {
      reject('UNKNOWN_SEASON', `No Season with code "${sheetRow.seasonCode}"`);
      continue;
    }
    if (season.status !== 'ACTIVE') {
      reject('INACTIVE_SEASON', `Season "${sheetRow.seasonCode}" is not ACTIVE`);
      continue;
    }

    if (sheetRow.barcodes.length > 0 && sheetRow.barcodes.length !== sheetRow.sizeCodes.length) {
      reject('SIZE_BARCODE_COUNT_MISMATCH', `${sheetRow.sizeCodes.length} Size Code(s) but ${sheetRow.barcodes.length} Barcode(s)`);
      continue;
    }

    const sizes: StyleSizeRequest[] = [];
    let sizeFailure: string | null = null;
    for (let i = 0; i < sheetRow.sizeCodes.length; i += 1) {
      const code = sheetRow.sizeCodes[i]!;
      const size = sizeByCode.get(norm(code));
      if (!size) {
        sizeFailure = `No Size with code "${code}"`;
        break;
      }
      if (size.status !== 'ACTIVE') {
        sizeFailure = `Size "${code}" is not ACTIVE`;
        break;
      }
      const barcode = sheetRow.barcodes[i]?.trim();
      sizes.push({ sizeId: size.id, barcode: barcode ? barcode : null });
    }
    if (sizeFailure) {
      reject(sizeFailure.includes('not ACTIVE') ? 'INACTIVE_SIZE' : 'UNKNOWN_SIZE', sizeFailure);
      continue;
    }

    const factoryMappings: StyleFactoryMappingRequest[] = [];
    let factoryFailure: { reason: BulkStyleImportRejectionReason; detail: string } | null = null;
    const requestedFactories = [
      ...sheetRow.factoryMappings.map((m) => ({ ...m, byName: false })),
      ...sheetRow.factoryNameMappings.map((m) => ({ factoryCode: m.factoryName, priceRaw: m.priceRaw, byName: true })),
    ];
    for (const mapping of requestedFactories) {
      const candidates = mapping.byName ? factories.filter((f) => norm(f.name).replace(/\s+/g, ' ') === norm(mapping.factoryCode).replace(/\s+/g, ' ')) : [];
      if (candidates.length > 1) {
        factoryFailure = { reason: 'AMBIGUOUS_FACTORY', detail: `Factory name "${mapping.factoryCode}" matches multiple Factories; review the source` };
        break;
      }
      const factory = mapping.byName ? candidates[0] : factoryByCode.get(norm(mapping.factoryCode));
      if (!factory) {
        factoryFailure = { reason: 'UNKNOWN_FACTORY', detail: `No Factory with code "${mapping.factoryCode}"` };
        break;
      }
      if (factory.status !== 'ACTIVE') {
        factoryFailure = { reason: 'INACTIVE_FACTORY', detail: `Factory "${mapping.factoryCode}" is not ACTIVE` };
        break;
      }
      const price = Number(mapping.priceRaw);
      if (!mapping.priceRaw || !Number.isFinite(price) || price < 0) {
        factoryFailure = { reason: 'INVALID_FACTORY_PRICE', detail: `"${mapping.priceRaw}" is not a valid ex-factory price for "${mapping.factoryCode}"` };
        break;
      }
      factoryMappings.push({ factoryId: factory.id, exFactoryPrice: price });
    }
    if (factoryFailure) {
      reject(factoryFailure.reason, factoryFailure.detail);
      continue;
    }

    // A blank cell (or the column being absent entirely) is "not supplied" —
    // never a rejection, and hsnId simply stays undefined below. Only a
    // non-blank, unresolvable value is rejected, matching Season/Size/Factory.
    let hsnId: string | undefined;
    if (sheetRow.hsnCode) {
      const hsn = hsnByCode.get(norm(sheetRow.hsnCode));
      if (!hsn) {
        reject('UNKNOWN_HSN', `No HSN with code "${sheetRow.hsnCode}"`);
        continue;
      }
      if (hsn.status !== 'ACTIVE') {
        reject('INACTIVE_HSN', `HSN "${sheetRow.hsnCode}" is not ACTIVE`);
        continue;
      }
      hsnId = hsn.id;
    }

    const rowAmbiguity = ambiguousByRow.get(sheetRow.rowNumber);
    if (rowAmbiguity || fileLevelImageWarnings.length > 0) {
      reject('AMBIGUOUS_IMAGE_ANCHOR', rowAmbiguity?.detail ?? 'Some expected images cannot be assigned safely; review the file-level image exceptions');
      continue;
    }

    const metadata: Pick<BulkStyleImportCreateFields, (typeof styleMetadataFields)[number]> = {};
    for (const field of styleMetadataFields) if (sheetRow[field] !== undefined) metadata[field] = sheetRow[field] || null;
    const create: BulkStyleImportCreateFields = {
      ...metadata,
      styleName: sheetRow.styleName,
      finalMrp,
      royaltyPercentage,
      seasonId: season.id,
      lmixNumber: sheetRow.lmixNumber || null,
      hsnId,
      sizes,
      factoryMappings,
      images: rowImages,
    };
    try {
      for (const image of rowImages) validateImageUpload(image.buffer);
    } catch (error) {
      reject('DOMAIN_VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
      continue;
    }

    const existingStyleId = existingStyleIdByNumber.get(sheetRow.styleNumber);
    if (existingStyleId) {
      const pending = await prisma.styleBulkImportRowResult.findMany({
        where: { styleNumber: sheetRow.styleNumber, styleId: existingStyleId, outcome: 'IMAGE_PENDING' },
        orderBy: { createdAt: 'desc' },
      });
      const priorPending = pending.find((prior) => matchesImageProvenance(prior.expectedImageChecksum, create));
      if (priorPending) {
        const conflict = await existingStyleConflict(existingStyleId, sheetRow.styleNumber, create, false);
        if (conflict) { reject('EXISTING_STYLE_CONFLICT', conflict); continue; }
        rows.push({ rowNumber: sheetRow.rowNumber, styleNumber: sheetRow.styleNumber,
          status: 'RESUME_IMAGE_PENDING', imageCount, existingStyleId, create,
          detail: 'Exact expected images match a prior interrupted import; safe to recover' });
        continue;
      }
      if (pending.length > 0 && rowImages.length > 0) {
        reject('IMAGE_PROVENANCE_MISMATCH', 'Expected images or Style fields differ from the interrupted import; review the source');
        continue;
      }
      const conflict = await existingStyleConflict(existingStyleId, sheetRow.styleNumber, create, false);
      if (conflict) {
        reject('EXISTING_STYLE_CONFLICT', conflict);
        continue;
      }
      if (rowImages.length > 0 && !await expectedImagesPresent(existingStyleId, rowImages)) {
        reject('IMAGE_PROVENANCE_MISMATCH', 'Existing Style gallery has different or missing image content; review it. Create-only import will not overwrite or add pictures.');
        continue;
      }
      rows.push({
        rowNumber: sheetRow.rowNumber,
        styleNumber: sheetRow.styleNumber,
        status: 'SKIP_EXISTING',
        imageCount,
        existingStyleId,
        create,
        detail: 'Exact supplied Style values already exist; no update performed',
      });
      continue;
    }

    try {
      const validated = await validateStyleCreate(create);
      const barcodes = validated.plannedSizes.flatMap((size) => size.barcode ? [size.barcode] : []);
      const collision = barcodes.find((barcode) => seenBarcodes.has(barcode));
      if (collision) {
        reject('DUPLICATE_BARCODE_IN_FILE', `Barcode ${collision} also belongs to row ${seenBarcodes.get(collision)}`);
        continue;
      }
      for (const barcode of barcodes) seenBarcodes.set(barcode, sheetRow.rowNumber);
    } catch (error) {
      reject('DOMAIN_VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
      continue;
    }
    rows.push({ rowNumber: sheetRow.rowNumber, styleNumber: sheetRow.styleNumber, status: 'CREATE', imageCount, create });
  }

  return { worksheet: selectedWorksheet, sourceFileChecksum, totalRows: sheetRows.length, rows, fileLevelImageWarnings };
}

// ---------------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------------

export type BulkStyleImportRowOutcome = 'COMPLETED' | 'SKIPPED_EXISTING' | 'IMAGE_PENDING' | 'FAILED';

export interface BulkStyleImportRowExecutionResult {
  rowNumber: number;
  styleNumber: string;
  outcome: BulkStyleImportRowOutcome;
  styleId?: string;
  detail?: string;
}

export interface BulkStyleImportExecutionSummary {
  runId: string;
  results: BulkStyleImportRowExecutionResult[];
}
async function existingStyleConflict(styleId: string, styleNumber: string, input: BulkStyleImportCreateFields, checkImages = true): Promise<string | null> {
  const existing = await prisma.style.findUnique({ where: { id: styleId }, include: { styleSizes: true, styleFactoryMappings: true } });
  if (!existing) return 'Existing Style changed; preview again';
  const changed: string[] = [];
  if (existing.styleNumber !== styleNumber || existing.styleName !== input.styleName) changed.push('Style identity/name');
  for (const field of styleMetadataFields) if (input[field] !== undefined && (existing[field] ?? '') !== (input[field] ?? '')) changed.push(field);
  if (existing.status !== 'ACTIVE') changed.push('inactive Style');
  if (Number(existing.finalMrp) !== input.finalMrp) changed.push('MRP');
  // Decimal-vs-number: compare via Number(), never the generic styleMetadataFields
  // string-coercion path above (`(existing[field] ?? '') !== (input[field] ?? '')`)
  // which would stringify a Prisma.Decimal incorrectly. Only compared when the
  // Royalty % column was actually present in this import (undefined means "not
  // specified" — an old workbook without the column must never be flagged as
  // conflicting just because an existing Style happens to have some stored
  // royalty); a present-but-blank cell (null) IS compared, since that's an
  // explicit, comparable "no royalty".
  if (input.royaltyPercentage !== undefined) {
    const existingRoyaltyPercentage = existing.royaltyPercentage === null ? null : Number(existing.royaltyPercentage);
    if (existingRoyaltyPercentage !== input.royaltyPercentage) changed.push('Royalty %');
  }
  if (existing.seasonId !== input.seasonId || (existing.lmixNumber ?? null) !== input.lmixNumber) changed.push('Season/LMIX');
  if (input.hsnId && existing.hsnId !== input.hsnId) changed.push('HSN');
  if (existing.styleSizes.length !== input.sizes.length || new Set(input.sizes.map(size => size.sizeId)).size !== input.sizes.length || input.sizes.some(size => !existing.styleSizes.some(current => current.sizeId === size.sizeId && current.status === 'ACTIVE' && (!size.barcode || current.barcode === size.barcode)))) changed.push('Sizes/barcodes');
  if (existing.styleFactoryMappings.length !== input.factoryMappings.length || new Set(input.factoryMappings.map(mapping => mapping.factoryId)).size !== input.factoryMappings.length || input.factoryMappings.some(mapping => !existing.styleFactoryMappings.some(current => current.factoryId === mapping.factoryId && current.status === 'ACTIVE' && Number(current.exFactoryPrice) === mapping.exFactoryPrice))) changed.push('Factory mappings/rates');
  if (checkImages && input.images.length && !await expectedImagesPresent(styleId, input.images)) changed.push('Images');
  return changed.length ? `Existing Style differs in ${changed.join(', ')}; review the source (no update performed)` : null;
}

// v2 is compatible with the existing TEXT column; legacy hex is read only for
// a single expected image, because it never established a multi-image manifest.
function imageProvenance(create: BulkStyleImportCreateFields): string {
  const { images, ...fields } = create;
  return JSON.stringify({ version: 2, fields, images: images.map((image) => ({ checksum: sha256Hex(image.buffer), sizeBytes: image.buffer.length,
    ...(image.representation === 'modern' || image.sourceFormat === 'jpg' ? { originalChecksum: image.originalChecksum, cellReference: image.cellReference, mediaPath: image.mediaPath, sourceFormat: image.sourceFormat } : {}) })) });
}
function matchesImageProvenance(recorded: string | null, create: BulkStyleImportCreateFields): boolean {
  if (!recorded || create.images.length === 0) return false;
  if (/^[a-f0-9]{64}$/.test(recorded)) return create.images.length === 1 && recorded === sha256Hex(create.images[0]!.buffer);
  return recorded === imageProvenance(create);
}

export async function requireBulkStyleImportActor(actor: CurrentUser, db: typeof prisma | Prisma.TransactionClient = prisma): Promise<CurrentUser> {
  const record = await db.user.findUnique({ where: { id: actor.id }, select: currentUserSelect });
  const current = record ? toCurrentUser(record) : undefined;
  if (!current || current.status !== 'ACTIVE' || !current.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER')) {
    throw HttpError.forbidden('Style imports require an active authorized ADMIN or MERCHANDISER');
  }
  return current;
}

async function expectedImagesPresent(styleId: string, images: EmbeddedImage[], db: typeof prisma | Prisma.TransactionClient = prisma): Promise<boolean> {
  const attached = await db.styleImage.findMany({ where: { styleId }, include: { file: true } });
  const consumed = new Set<string>();
  for (const expected of images) {
    const checksum = sha256Hex(expected.buffer);
    const actual = attached.find((image) => !consumed.has(image.id) && image.file.checksumSha256 === checksum && image.file.sizeBytes === expected.buffer.length);
    if (!actual) return false;
    consumed.add(actual.id);
    try {
      const bytes = await getFileStorage().read(actual.file.storageKey);
      if (bytes.length !== expected.buffer.length || sha256Hex(bytes) !== checksum) return false;
    } catch { return false; }
  }
  return true;
}

export async function executeBulkStyleImport(
  actor: CurrentUser, plan: BulkStyleImportPlan, sourceFileName: string,
): Promise<BulkStyleImportExecutionSummary> {
  actor = await requireBulkStyleImportActor(actor);
  const runId = createId();
  await prisma.styleBulkImportRun.create({ data: { id: runId, sourceFileName,
    sourceFileChecksum: plan.sourceFileChecksum, status: 'EXECUTED', actorUserId: actor.id, totalRows: plan.totalRows } });
  const results: BulkStyleImportRowExecutionResult[] = [];
  for (const row of plan.rows) {
    const base = { rowNumber: row.rowNumber, styleNumber: row.styleNumber };
    const staged: StagedStyleImage[] = [];
    const retained = new Set<string>();
    let styleId = row.existingStyleId;
    try {
      actor = await requireBulkStyleImportActor(actor);
      if (row.status === 'SKIP_EXISTING' && row.create && row.existingStyleId) {
        const conflict = await existingStyleConflict(row.existingStyleId, row.styleNumber, row.create);
        if (conflict) throw HttpError.conflict(conflict);
      }
      if (row.status === 'REJECTED' || row.status === 'SKIP_EXISTING') {
        const outcome = row.status === 'REJECTED' ? 'FAILED' : 'SKIPPED_EXISTING';
        await prisma.styleBulkImportRowResult.create({ data: { id: createId(), runId, ...base,
          styleId: row.existingStyleId, outcome, detail: row.detail ?? row.reason } });
        results.push({ ...base, outcome, styleId: row.existingStyleId, detail: row.detail ?? row.reason });
        continue;
      }
      const create = row.create!;
      if (!create) throw HttpError.badRequest('The planned Style fields are missing');
      const provenance = imageProvenance(create);
      if (row.status === 'RESUME_IMAGE_PENDING') {
        const pending = await prisma.styleBulkImportRowResult.findMany({
          where: { styleNumber: row.styleNumber, styleId, outcome: { in: ['IMAGE_PENDING', 'COMPLETED'] } },
        });
        if (!styleId || !pending.some((prior) => matchesImageProvenance(prior.expectedImageChecksum, create))) {
          throw HttpError.conflict('No exact interrupted-import provenance matches these expected images');
        }
        const style = await prisma.style.findUnique({ where: { id: styleId } });
        if (!style || style.styleNumber !== row.styleNumber) throw HttpError.conflict('Recovery Style identity no longer matches');
      } else {
        await validateStyleCreate(create);
      }
      const alreadyPresent = styleId && await expectedImagesPresent(styleId, create.images);
      if (!alreadyPresent) {
        // A new Style's id isn't known until the create commits below, so
        // its images are staged under a placeholder path and relocated to
        // style-images/<styleId>/... inside commit() once it is.
        for (const image of create.images)
          staged.push(await stageStyleImage({ buffer: image.buffer, originalName: image.fileName }, styleId ?? undefined));
      }
      const commit = async (tx: Prisma.TransactionClient, created: { id: string }) => {
        await requireBulkStyleImportActor(actor, tx);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('style_images:' || ${created.id}, 0))::text`;
        if (row.status === 'RESUME_IMAGE_PENDING') {
          // Ordinary Style updates acquire the row lock too. Validate identity
          // after staging and retain this lock through image/provenance commit.
          const identities = await tx.$queryRaw<Array<{ styleNumber: string; seasonId: string; lmixNumber: string | null }>>`
            SELECT style_number AS "styleNumber", season_id AS "seasonId", lmix_number AS "lmixNumber"
            FROM styles WHERE id = ${created.id} FOR UPDATE`;
          const identity = identities[0];
          if (!identity || identity.styleNumber !== row.styleNumber || identity.seasonId !== create.seasonId || identity.lmixNumber !== create.lmixNumber) {
            throw HttpError.conflict('Recovery Style identity no longer matches the reviewed source');
          }
        }
        if (alreadyPresent && !await expectedImagesPresent(created.id, create.images, tx)) {
          throw HttpError.conflict('Expected images changed during recovery; retry this import');
        }
        const occurrences = new Map<string, number>();
        for (const image of staged) {
          if (image.storageKey.startsWith('style-images/staged/')) {
            const relocatedKey = image.storageKey.replace('style-images/staged/', `style-images/${created.id}/`);
            await getFileStorage().put(relocatedKey, await getFileStorage().read(image.storageKey));
            await getFileStorage().delete(image.storageKey);
            image.storageKey = relocatedKey;
          }
          const occurrence = occurrences.get(image.checksum) ?? 0;
          occurrences.set(image.checksum, occurrence + 1);
          const attached = await attachStagedStyleImage(actor, tx, created.id, image, { occurrence });
          if (attached.created) retained.add(image.storageKey);
        }
        await tx.styleBulkImportRowResult.create({ data: { id: createId(), runId, ...base,
          styleId: created.id, outcome: 'COMPLETED', expectedImageChecksum: provenance } });
        styleId = created.id;
        if (row.status === 'RESUME_IMAGE_PENDING') {
          // Reconcile older pending rows atomically, so subsequent retries skip.
          const pending = await tx.styleBulkImportRowResult.findMany({ where: { styleId: created.id, styleNumber: row.styleNumber, outcome: 'IMAGE_PENDING' } });
          await tx.styleBulkImportRowResult.updateMany({
            where: { id: { in: pending.filter((prior) => matchesImageProvenance(prior.expectedImageChecksum, create)).map((prior) => prior.id) } },
            data: { outcome: 'COMPLETED', detail: 'Expected images recovered and verified' },
          });
        }
      };
      if (row.status === 'RESUME_IMAGE_PENDING') {
        await prisma.$transaction((tx) => commit(tx, { id: styleId! }));
      } else {
        const { images, ...fields } = create;
        void images;
        const style = await createStyle(actor, { styleNumber: row.styleNumber, ...fields }, { onCommitted: commit });
        styleId = style.id;
      }
      results.push({ ...base, outcome: 'COMPLETED', styleId });
    } catch (error) {
      const committedStyleId = styleCommittedDespiteError(error);
      if (committedStyleId) {
        // createStyle's transaction (Style, images and the COMPLETED
        // row-result) already committed; this is a separate failure in
        // the post-commit read-back, not the write itself rolling back.
        results.push({ ...base, outcome: 'COMPLETED', styleId: committedStyleId });
        continue;
      }
      retained.clear(); // Every metadata/provenance write rolled back.
      const detail = error instanceof Error ? error.message : String(error);
      const outcome = row.status === 'RESUME_IMAGE_PENDING' ? 'IMAGE_PENDING' : 'FAILED';
      await prisma.styleBulkImportRowResult.create({ data: { id: createId(), runId, ...base,
        styleId: row.status === 'RESUME_IMAGE_PENDING' ? row.existingStyleId : undefined,
        outcome, expectedImageChecksum: row.create ? imageProvenance(row.create) : undefined, detail } });
      results.push({ ...base, outcome, detail, styleId: row.status === 'RESUME_IMAGE_PENDING' ? row.existingStyleId : undefined });
    } finally {
      for (const image of staged) if (!retained.has(image.storageKey)) await discardStagedStyleImage(image);
    }
  }
  return { runId, results };
}

function confirmationPlanChecksum(plan: BulkStyleImportPlan): string {
  return sha256Hex(Buffer.from(JSON.stringify({ checksum: plan.sourceFileChecksum, worksheet: plan.worksheet,
    eligible: plan.rows.filter((row) => row.status === 'CREATE' || row.status === 'RESUME_IMAGE_PENDING')
      .map((row) => ({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, status: row.status, provenance: row.create ? imageProvenance(row.create) : null })) })));
}
export function bulkStyleImportConfirmationToken(plan: BulkStyleImportPlan, actorId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, actorId, expiresAt: now + 15 * 60_000, planChecksum: confirmationPlanChecksum(plan) })).toString('base64url');
  return `${payload}.${createHmac('sha256', env.JWT_ACCESS_SECRET).update(payload).digest('base64url')}`;
}
export function verifyBulkStyleImportConfirmation(plan: BulkStyleImportPlan, actorId: string, token: string, now = Date.now()): void {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) throw new Error('Malformed confirmation');
    const expected = createHmac('sha256', env.JWT_ACCESS_SECRET).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid signature');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { version: number; actorId: string; expiresAt: number; planChecksum: string };
    if (parsed.version !== 1 || parsed.actorId !== actorId || !Number.isFinite(parsed.expiresAt) || now >= parsed.expiresAt || parsed.planChecksum !== confirmationPlanChecksum(plan)) throw new Error('Stale confirmation');
  } catch {
    throw HttpError.conflict('Confirmation expired or workbook, worksheet, actor or eligible records changed; preview again');
  }
}

export function buildBulkStyleImportTemplate(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[
    'Style Number', 'Style Name', 'Final MRP', 'Season Code', 'Size Codes', 'Financial Year',
    'LMIX Number', 'HSN Code', 'Barcodes', 'Factory Name Mappings', 'Factory Mappings',
    'Description', 'Category', 'IP Name', 'Licensor', 'Colour', 'Royalty %',
  ]]), 'Styles');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Style import instructions'],
    ['Select the Styles worksheet. Required: Style Number, Style Name, Final MRP, Season Code and Size Codes.'],
    ['Pictures: embed PNG or JPEG pictures anchored to their Style row, or use Excel Picture in Cell on that row.'],
    ['Pictures may be in any column; multiple pictures on one Style row are supported. JPEG sources are converted to PNG.'],
    ['No filename, base64 or URL column is required. Only image bytes packaged in the workbook are used.'],
    ['Financial Year disambiguates Season Codes used in more than one year. Supply existing master codes; do not infer missing business fields.'],
    ['Royalty % is optional (0-100). Enter a plain number such as 7.5 to mean 7.5%; leave the cell blank for no royalty.'],
  ]), 'Instructions');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Original cell display values are exported as typed text, never executable formulas. */
export function buildBulkStyleImportExceptions(buffer: Buffer, plan: BulkStyleImportPlan): Buffer {
  const source = XLSX.read(buffer, { type: 'buffer' });
  const sheet = source.Sheets[plan.worksheet ?? source.SheetNames[0]!]!;
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0, raw: false, defval: '', blankrows: true });
  const headers = raw[0] ?? [];
  const data = [
    [...headers.map(String), 'Source Row', 'Exception Code', 'Exception Detail', 'Correction Instructions'],
    ...plan.rows.filter((row) => row.status === 'REJECTED').map((row) => [
      ...headers.map((_, column) => String(raw[row.rowNumber - 1]?.[column] ?? '')),
      String(row.rowNumber), row.reason ?? '', row.detail ?? '',
      'Copy corrected values into the original workbook to retain embedded images, then preview again.',
    ]),
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(data), 'Exceptions');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function styleImportReportOutcome(outcome: BulkStyleImportRowOutcome): 'CREATE' | 'SKIP_EXISTING' | 'NEEDS_REVIEW' | 'FAILED' {
  return outcome === 'COMPLETED' ? 'CREATE' : outcome === 'SKIPPED_EXISTING' ? 'SKIP_EXISTING' : outcome === 'IMAGE_PENDING' ? 'NEEDS_REVIEW' : 'FAILED';
}

export function summarizeBulkStyleImportPlan(plan: BulkStyleImportPlan) {
  const byStatus = (status: BulkStyleImportRowStatus) => plan.rows.filter((row) => row.status === status).length;
  return {
    totalRows: plan.totalRows,
    create: byStatus('CREATE'),
    skipExisting: byStatus('SKIP_EXISTING'),
    resumeImagePending: byStatus('RESUME_IMAGE_PENDING'),
    rejected: byStatus('REJECTED'),
    fileLevelImageWarnings: plan.fileLevelImageWarnings.length,
  };
}
