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
// Primary Style images are PNGs embedded directly in the workbook, anchored
// to their Style's row (see xlsx-embedded-images.ts) — not a column.
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import {
  extractEmbeddedImagesByRow,
  type EmbeddedImage,
  type EmbeddedImageAmbiguity,
} from '../../cli/xlsx-embedded-images.js';
import { createStyle, type StyleFactoryMappingRequest, type StyleSizeRequest } from './master-data.service.js';
import { uploadStyleImage } from './style-images.service.js';

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
  finalMrpRaw: string;
  seasonCode: string;
  // Optional. The existing barcode generator (barcode.util.ts, unchanged)
  // requires either an explicit barcode per Size or a Style LMIX Number in
  // the form "LMIX<digits>" to auto-generate one — this column exists so a
  // bulk-imported Style can use auto-generation too, not just a supplied
  // barcode per Size.
  lmixNumber: string;
  // Optional. Blank (or the column missing entirely) means "no HSN yet" —
  // never a rejection. A non-blank value must resolve to an ACTIVE Hsn.
  hsnCode: string;
  sizeCodes: string[];
  barcodes: string[];
  factoryMappings: Array<{ factoryCode: string; priceRaw: string }>;
}

const SHEET_HEADERS: Record<
  string,
  keyof Omit<BulkStyleImportSheetRow, 'rowNumber' | 'sizeCodes' | 'barcodes' | 'factoryMappings'>
> = {
  'style number': 'styleNumber',
  'style name': 'styleName',
  'final mrp': 'finalMrpRaw',
  'season code': 'seasonCode',
  'lmix number': 'lmixNumber',
  'hsn code': 'hsnCode',
};

export function parseBulkStyleImportSheet(buffer: Buffer): BulkStyleImportSheetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) throw new Error('The file has no sheets');
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false });
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

  return raw.slice(1).map((cells, index) => {
    const row: Record<string, string> = {};
    headerCells.forEach((headerCell, column) => {
      const key = SHEET_HEADERS[headerCell];
      if (key) row[key] = String(cells[column] ?? '').trim();
    });
    return {
      rowNumber: index + 2,
      styleNumber: row.styleNumber ?? '',
      styleName: row.styleName ?? '',
      finalMrpRaw: row.finalMrpRaw ?? '',
      seasonCode: row.seasonCode ?? '',
      lmixNumber: row.lmixNumber ?? '',
      hsnCode: row.hsnCode ?? '',
      sizeCodes: splitList(String(cells[sizeCodesColumn] ?? '')),
      barcodes: barcodesColumn >= 0 ? splitPositionalList(String(cells[barcodesColumn] ?? '')) : [],
      factoryMappings:
        factoryMappingsColumn >= 0
          ? splitList(String(cells[factoryMappingsColumn] ?? ''), ';')
              .map((pair) => {
                const [factoryCode, priceRaw] = pair.split(':');
                return { factoryCode: (factoryCode ?? '').trim(), priceRaw: (priceRaw ?? '').trim() };
              })
              .filter((mapping) => mapping.factoryCode)
          : [],
    };
  });
}

// ---------------------------------------------------------------------------
// Planning (read-only: validates against the DB, never writes).
// ---------------------------------------------------------------------------

export type BulkStyleImportRejectionReason =
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
  | 'SIZE_BARCODE_COUNT_MISMATCH'
  | 'AMBIGUOUS_IMAGE_ANCHOR';

export type BulkStyleImportRowStatus = 'CREATE' | 'SKIP_EXISTING' | 'RESUME_IMAGE_PENDING' | 'REJECTED';

export interface BulkStyleImportCreateFields {
  styleName: string;
  finalMrp: number;
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
  sourceFileChecksum: string;
  totalRows: number;
  rows: BulkStyleImportPlanRow[];
  /** Embedded-image problems that couldn't be attributed to any specific row (e.g. an unparseable anchor) — reported, never silently dropped, but don't by themselves reject a row. */
  fileLevelImageWarnings: EmbeddedImageAmbiguity[];
}

export async function planBulkStyleImport(buffer: Buffer): Promise<BulkStyleImportPlan> {
  const sourceFileChecksum = sha256Hex(buffer);
  const sheetRows = parseBulkStyleImportSheet(buffer);
  const { imagesByRow, ambiguous } = extractEmbeddedImagesByRow(buffer);
  const ambiguousByRow = new Map(ambiguous.filter((a) => a.rowNumber !== undefined).map((a) => [a.rowNumber!, a]));
  const fileLevelImageWarnings = ambiguous.filter((a) => a.rowNumber === undefined);

  const [seasons, sizes, factories, hsns, existingStyles] = await Promise.all([
    prisma.season.findMany({ select: { id: true, code: true, status: true } }),
    prisma.size.findMany({ select: { id: true, code: true, status: true } }),
    prisma.factory.findMany({ select: { id: true, code: true, status: true } }),
    prisma.hsn.findMany({ select: { id: true, code: true, status: true } }),
    prisma.style.findMany({ select: { id: true, styleNumber: true } }),
  ]);
  const seasonByCode = new Map(seasons.map((s) => [norm(s.code), s]));
  const sizeByCode = new Map(sizes.map((s) => [norm(s.code), s]));
  const factoryByCode = new Map(factories.map((f) => [norm(f.code), f]));
  const hsnByCode = new Map(hsns.map((h) => [norm(h.code), h]));
  const existingStyleIdByNumber = new Map(existingStyles.map((s) => [s.styleNumber, s.id]));

  const rows: BulkStyleImportPlanRow[] = [];
  const seenStyleNumbers = new Set<string>();

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

    const season = seasonByCode.get(norm(sheetRow.seasonCode));
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
    for (const mapping of sheetRow.factoryMappings) {
      const factory = factoryByCode.get(norm(mapping.factoryCode));
      if (!factory) {
        factoryFailure = { reason: 'UNKNOWN_FACTORY', detail: `No Factory with code "${mapping.factoryCode}"` };
        break;
      }
      if (factory.status !== 'ACTIVE') {
        factoryFailure = { reason: 'INACTIVE_FACTORY', detail: `Factory "${mapping.factoryCode}" is not ACTIVE` };
        break;
      }
      const price = Number(mapping.priceRaw);
      if (!Number.isFinite(price) || price < 0) {
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
    if (rowAmbiguity) {
      reject('AMBIGUOUS_IMAGE_ANCHOR', rowAmbiguity.detail);
      continue;
    }

    const create: BulkStyleImportCreateFields = {
      styleName: sheetRow.styleName,
      finalMrp,
      seasonId: season.id,
      lmixNumber: sheetRow.lmixNumber || null,
      hsnId,
      sizes,
      factoryMappings,
      images: rowImages,
    };

    const existingStyleId = existingStyleIdByNumber.get(sheetRow.styleNumber);
    if (existingStyleId) {
      const primaryImageChecksum = rowImages[0] ? sha256Hex(rowImages[0].buffer) : null;
      const priorPending =
        primaryImageChecksum &&
        (await prisma.styleBulkImportRowResult.findFirst({
          where: {
            styleNumber: sheetRow.styleNumber,
            styleId: existingStyleId,
            outcome: 'IMAGE_PENDING',
            expectedImageChecksum: primaryImageChecksum,
          },
          orderBy: { createdAt: 'desc' },
        }));

      if (priorPending) {
        rows.push({
          rowNumber: sheetRow.rowNumber,
          styleNumber: sheetRow.styleNumber,
          status: 'RESUME_IMAGE_PENDING',
          imageCount,
          existingStyleId,
          create,
          detail: 'Matches a prior import that created this Style but had not finished attaching its image — safe to resume',
        });
        continue;
      }

      rows.push({
        rowNumber: sheetRow.rowNumber,
        styleNumber: sheetRow.styleNumber,
        status: 'SKIP_EXISTING',
        imageCount,
        existingStyleId,
        detail: 'A Style with this Style Number already exists and is left untouched (create-only)',
      });
      continue;
    }

    rows.push({ rowNumber: sheetRow.rowNumber, styleNumber: sheetRow.styleNumber, status: 'CREATE', imageCount, create });
  }

  return { sourceFileChecksum, totalRows: sheetRows.length, rows, fileLevelImageWarnings };
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

async function attachImages(
  actor: CurrentUser,
  styleId: string,
  images: EmbeddedImage[],
): Promise<{ allSucceeded: boolean; detail?: string }> {
  let failureCount = 0;
  for (const image of images) {
    try {
      await uploadStyleImage(actor, styleId, { buffer: image.buffer, originalName: image.fileName });
    } catch {
      failureCount += 1;
    }
  }
  return failureCount === 0
    ? { allSucceeded: true }
    : { allSucceeded: false, detail: `${failureCount} of ${images.length} image(s) failed to attach — safe to retry by re-running this import` };
}

export async function executeBulkStyleImport(
  actor: CurrentUser,
  plan: BulkStyleImportPlan,
  sourceFileName: string,
): Promise<BulkStyleImportExecutionSummary> {
  const runId = createId();
  await prisma.styleBulkImportRun.create({
    data: {
      id: runId,
      sourceFileName,
      sourceFileChecksum: plan.sourceFileChecksum,
      status: 'EXECUTED',
      actorUserId: actor.id,
      totalRows: plan.totalRows,
    },
  });

  const results: BulkStyleImportRowExecutionResult[] = [];

  const recordRowResult = async (data: {
    rowNumber: number;
    styleNumber: string;
    styleId?: string;
    outcome: BulkStyleImportRowOutcome;
    expectedImageChecksum?: string | null;
    detail?: string | null;
  }): Promise<void> => {
    await prisma.styleBulkImportRowResult.create({
      data: {
        id: createId(),
        runId,
        rowNumber: data.rowNumber,
        styleNumber: data.styleNumber,
        styleId: data.styleId,
        outcome: data.outcome,
        expectedImageChecksum: data.expectedImageChecksum ?? null,
        detail: data.detail ?? null,
      },
    });
  };

  for (const row of plan.rows) {
    if (row.status === 'REJECTED') {
      await recordRowResult({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'FAILED', detail: row.detail ?? row.reason });
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'FAILED', detail: row.detail ?? row.reason });
      continue;
    }

    if (row.status === 'SKIP_EXISTING') {
      await recordRowResult({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, styleId: row.existingStyleId, outcome: 'SKIPPED_EXISTING' });
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'SKIPPED_EXISTING', styleId: row.existingStyleId });
      continue;
    }

    if (row.status === 'RESUME_IMAGE_PENDING') {
      const styleId = row.existingStyleId!;
      // Re-verify at execute time, not just at plan time — a concurrent
      // retry (or the same row recovered through some other path) may have
      // already attached the image since the plan was computed.
      const currentImageCount = await prisma.styleImage.count({ where: { styleId } });
      if (currentImageCount > 0) {
        await recordRowResult({
          rowNumber: row.rowNumber,
          styleNumber: row.styleNumber,
          styleId,
          outcome: 'COMPLETED',
          detail: 'Image already attached from a prior run; reconciled without re-upload',
        });
        results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'COMPLETED', styleId });
        continue;
      }
      const attach = await attachImages(actor, styleId, row.create!.images);
      const outcome: BulkStyleImportRowOutcome = attach.allSucceeded ? 'COMPLETED' : 'IMAGE_PENDING';
      await recordRowResult({
        rowNumber: row.rowNumber,
        styleNumber: row.styleNumber,
        styleId,
        outcome,
        expectedImageChecksum: sha256Hex(row.create!.images[0]!.buffer),
        detail: attach.detail,
      });
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome, styleId, detail: attach.detail });
      continue;
    }

    // CREATE
    const create = row.create!;
    const primaryImageChecksum = create.images[0] ? sha256Hex(create.images[0].buffer) : null;
    let createdStyleId: string | undefined;
    try {
      await createStyle(
        actor,
        {
          styleNumber: row.styleNumber,
          styleName: create.styleName,
          finalMrp: create.finalMrp,
          seasonId: create.seasonId,
          lmixNumber: create.lmixNumber,
          // Left out of the object entirely when undefined (no HSN Code
          // supplied) — never sent as null, so createStyle's own
          // `hsnId !== undefined && hsnId !== null` check is skipped exactly
          // as if this column didn't exist.
          ...(create.hsnId !== undefined ? { hsnId: create.hsnId } : {}),
          sizes: create.sizes,
          factoryMappings: create.factoryMappings,
        },
        {
          // Runs inside createStyle's own transaction — the provenance row
          // and the Style it describes commit or roll back together.
          onCommitted: async (tx, created) => {
            createdStyleId = created.id;
            await tx.styleBulkImportRowResult.create({
              data: {
                id: createId(),
                runId,
                rowNumber: row.rowNumber,
                styleNumber: row.styleNumber,
                styleId: created.id,
                outcome: create.images.length > 0 ? 'IMAGE_PENDING' : 'COMPLETED',
                expectedImageChecksum: primaryImageChecksum,
              },
            });
          },
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error creating Style';
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'FAILED', detail });
      // Best-effort audit row — the create's own transaction already rolled
      // back, so this is a separate, non-atomic write purely for reporting;
      // its own failure must never mask the real error above.
      await recordRowResult({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'FAILED', detail }).catch(() => {});
      continue;
    }

    if (create.images.length === 0) {
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'COMPLETED', styleId: createdStyleId });
      continue;
    }

    const attach = await attachImages(actor, createdStyleId!, create.images);
    if (attach.allSucceeded) {
      await prisma.styleBulkImportRowResult.updateMany({
        where: { runId, rowNumber: row.rowNumber },
        data: { outcome: 'COMPLETED', detail: null },
      });
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'COMPLETED', styleId: createdStyleId });
    } else {
      results.push({ rowNumber: row.rowNumber, styleNumber: row.styleNumber, outcome: 'IMAGE_PENDING', styleId: createdStyleId, detail: attach.detail });
    }
  }

  return { runId, results };
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
