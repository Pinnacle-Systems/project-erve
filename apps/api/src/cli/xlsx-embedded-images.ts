// Reads PNG/JPEG anchored drawings and Picture-in-Cell media from a selected
// .xlsx worksheet, resolved to physical spreadsheet rows. The `xlsx`
// (SheetJS) package already used elsewhere in this CLI suite only reads
// cell text/values — it has no concept of embedded drawings — so this reads
// the workbook's underlying OOXML (an .xlsx file is a zip archive) directly:
// workbook.xml -> the first sheet's relationship -> that sheet's drawing
// relationship -> the drawing's anchors -> each anchor's image relationship
// -> the actual media file.
//
// Deliberately conservative: any anchor that doesn't resolve to exactly one
// row and one supported picture is reported in `ambiguous` and never guessed at —
// callers must treat those rows as rejected, not silently skipped or
// attached to the wrong Style.
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { sniffImage } from '../storage/image-sniff.js';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { extractRichDataImages } from './xlsx-rich-data-images.js';

// OOXML relationship Targets are relative to the directory containing the
// .rels file's OWNER (not the .rels file itself), and routinely use "../"
// to reach a sibling directory (e.g. a sheet's drawing relationship, or a
// drawing's own image relationships) — naive string prepending breaks on
// those; this resolves and normalizes properly, the same way a browser
// resolves a relative URL.
function resolveRelationshipTarget(ownerDir: string, target: string): string {
  return target.startsWith('/')
    ? path.posix.normalize(target.slice(1))
    : path.posix.normalize(path.posix.join(ownerDir, target));
}

export interface EmbeddedImage {
  buffer: Buffer;
  fileName: string;
  /** 1-indexed spreadsheet row this image is anchored to (header is row 1 — same convention the sheet-row reader uses). */
  rowNumber: number;
  cellReference?: string;
  mediaPath?: string;
  representation?: 'legacy' | 'modern';
  sourceFormat?: 'png' | 'jpg';
  originalChecksum?: string;
  normalizedChecksum?: string;
}

export interface EmbeddedImageAmbiguity {
  reason:
    | 'UNSUPPORTED_ANCHOR_SHAPE'
    | 'UNPARSEABLE_ROW'
    | 'NO_IMAGE_REFERENCE'
    | 'UNRESOLVED_IMAGE_REFERENCE'
    | 'MISSING_MEDIA_FILE'
    | 'NON_PNG_IMAGE'
    | 'BROKEN_DRAWING_REFERENCE'
    | 'ORPHAN_IMAGE_ANCHOR'
    | 'INVALID_RICH_DATA_REFERENCE'
    | 'CORRUPT_IMAGE';
  detail: string;
  /** The 1-indexed spreadsheet row this ambiguity is attributable to, when known — absent for UNSUPPORTED_ANCHOR_SHAPE/UNPARSEABLE_ROW, where the row itself couldn't be determined. */
  rowNumber?: number;
}

export interface EmbeddedImageExtractionResult {
  imagesByRow: Map<number, EmbeddedImage[]>;
  ambiguous: EmbeddedImageAmbiguity[];
  imageMetadataPresent?: boolean;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

function readXml(zip: AdmZip, path: string): Record<string, unknown> | null {
  const entry = zip.getEntry(path);
  if (!entry) return null;
  try {
    return xmlParser.parse(entry.getData().toString('utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function get(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

interface OoxmlRelationship {
  Id?: string;
  Type?: string;
  Target?: string;
  TargetMode?: string;
}

interface OoxmlSheetRef {
  name?: string;
  'r:id'?: string;
  id?: string;
}

interface OoxmlAnchor {
  'xdr:from'?: { 'xdr:row'?: unknown; 'xdr:col'?: unknown };
  'xdr:pic'?: { 'xdr:blipFill'?: { 'a:blip'?: { 'r:embed'?: string } } };
}

/**
 * Returns an empty result (no images, no ambiguities) for any input that
 * isn't a workbook with a readable drawing — that's the common, expected
 * case of "a sheet with no embedded images", not an error.
 */
export function extractEmbeddedImagesByRow(
  buffer: Buffer,
  sheetIndex: number | string = 0,
): EmbeddedImageExtractionResult {
  const result: EmbeddedImageExtractionResult = { imagesByRow: new Map(), ambiguous: [] };

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return result;
  }

  const workbookXml = readXml(zip, 'xl/workbook.xml');
  const workbookRels = readXml(zip, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !workbookRels) return result;

  const sheets = asArray<OoxmlSheetRef>(
    get(workbookXml, ['workbook', 'sheets', 'sheet']) as
      OoxmlSheetRef | OoxmlSheetRef[] | undefined,
  );
  const targetSheet =
    typeof sheetIndex === 'string'
      ? sheets.find((sheet) => sheet.name === sheetIndex)
      : sheets[sheetIndex];
  if (!targetSheet) return result;
  const sheetRid = targetSheet['r:id'] ?? targetSheet.id;
  const workbookRelationships = asArray<OoxmlRelationship>(
    get(workbookRels, ['Relationships', 'Relationship']) as
      OoxmlRelationship | OoxmlRelationship[] | undefined,
  );
  const sheetRel = workbookRelationships.find((rel) => rel.Id === sheetRid);
  if (!sheetRel?.Target) return result;

  const sheetPath = resolveRelationshipTarget('xl', sheetRel.Target);
  try {
    const sheetDir = path.posix.dirname(sheetPath);
    const sheetFileName = path.posix.basename(sheetPath);
    const sheetXml = readXml(zip, sheetPath);
    const drawing = get(sheetXml, ['worksheet', 'drawing']) as { 'r:id'?: string } | undefined;
    const declaredDrawingId = drawing?.['r:id'];
    if (drawing) result.imageMetadataPresent = true;
    const brokenDrawing = () => {
      result.ambiguous.push({
        reason: 'BROKEN_DRAWING_REFERENCE',
        detail:
          'The worksheet declares images but its drawing relationship is missing or unreadable; review the source images',
      });
      return result;
    };
    const sheetRelsXml = readXml(zip, path.posix.join(sheetDir, `_rels/${sheetFileName}.rels`));
    if (!sheetRelsXml) return drawing ? brokenDrawing() : result;

    const sheetRelationships = asArray<OoxmlRelationship>(
      get(sheetRelsXml, ['Relationships', 'Relationship']) as
        OoxmlRelationship | OoxmlRelationship[] | undefined,
    );
    const drawingRel = sheetRelationships.find(
      (rel) => String(rel.Type).endsWith('/drawing') && (!drawing || rel.Id === declaredDrawingId),
    );
    if (!drawingRel?.Target) return drawing ? brokenDrawing() : result;

    const drawingPath = resolveRelationshipTarget(sheetDir, drawingRel.Target);
    const drawingDir = path.posix.dirname(drawingPath);
    const drawingFileName = path.posix.basename(drawingPath);
    const drawingXml = readXml(zip, drawingPath);
    const drawingRelsXml = readXml(
      zip,
      path.posix.join(drawingDir, `_rels/${drawingFileName}.rels`),
    );
    if (!drawingXml || !drawingRelsXml) {
      result.ambiguous.push({
        reason: 'BROKEN_DRAWING_REFERENCE',
        detail:
          'The worksheet references drawing parts that are missing or unreadable; review the source images',
      });
      return result;
    }

    const mediaByRid = new Map<string, string>();
    const drawingRelationships = asArray<OoxmlRelationship>(
      get(drawingRelsXml, ['Relationships', 'Relationship']) as
        OoxmlRelationship | OoxmlRelationship[] | undefined,
    );
    for (const rel of drawingRelationships) {
      if (
        rel.Id &&
        rel.Target &&
        rel.TargetMode !== 'External' &&
        !/^[a-z]+:/i.test(rel.Target) &&
        String(rel.Type).endsWith('/image')
      ) {
        mediaByRid.set(rel.Id, resolveRelationshipTarget(drawingDir, rel.Target));
      }
    }

    const wsDr = get(drawingXml, ['xdr:wsDr']) as Record<string, unknown> | undefined;
    if (!wsDr) {
      result.ambiguous.push({
        reason: 'BROKEN_DRAWING_REFERENCE',
        detail: 'The expected worksheet drawing has no readable anchors',
      });
      return result;
    }
    const anchors = [
      ...asArray<OoxmlAnchor>(wsDr['xdr:twoCellAnchor'] as OoxmlAnchor | OoxmlAnchor[] | undefined),
      ...asArray<OoxmlAnchor>(wsDr['xdr:oneCellAnchor'] as OoxmlAnchor | OoxmlAnchor[] | undefined),
    ];
    if (anchors.length) result.imageMetadataPresent = true;
    if (wsDr['xdr:absoluteAnchor']) {
      result.imageMetadataPresent = true;
      result.ambiguous.push({
        reason: 'UNSUPPORTED_ANCHOR_SHAPE',
        detail:
          'Absolute picture anchors have no Style row; anchor the picture to a cell or use Picture in Cell',
      });
    }

    for (const anchor of anchors) {
      const from = anchor['xdr:from'];
      const pic = anchor['xdr:pic'];
      if (!from || !pic) {
        result.ambiguous.push({
          reason: 'UNSUPPORTED_ANCHOR_SHAPE',
          detail: 'An anchored drawing element is not a simple picture anchor',
        });
        continue;
      }

      const rowRaw = from['xdr:row'];
      const anchorRow =
        rowRaw !== null && typeof rowRaw === 'object'
          ? Number((rowRaw as { '#text'?: unknown })['#text'])
          : Number(rowRaw);
      if (!Number.isInteger(anchorRow) || anchorRow < 0) {
        result.ambiguous.push({
          reason: 'UNPARSEABLE_ROW',
          detail: 'Could not read the anchor row for an embedded image',
        });
        continue;
      }
      const spreadsheetRow = anchorRow + 1;

      const rId = pic['xdr:blipFill']?.['a:blip']?.['r:embed'];
      if (!rId) {
        result.ambiguous.push({
          reason: 'NO_IMAGE_REFERENCE',
          detail: `Row ${spreadsheetRow}: a picture anchor has no image reference`,
          rowNumber: spreadsheetRow,
        });
        continue;
      }

      const mediaPath = mediaByRid.get(rId);
      if (!mediaPath) {
        result.ambiguous.push({
          reason: 'UNRESOLVED_IMAGE_REFERENCE',
          detail: `Row ${spreadsheetRow}: image reference "${rId}" does not resolve to a media file`,
          rowNumber: spreadsheetRow,
        });
        continue;
      }

      const mediaEntry = zip.getEntry(mediaPath);
      if (!mediaEntry) {
        result.ambiguous.push({
          reason: 'MISSING_MEDIA_FILE',
          detail: `Row ${spreadsheetRow}: media file "${mediaPath}" is missing from the workbook`,
          rowNumber: spreadsheetRow,
        });
        continue;
      }

      const mediaBuffer = mediaEntry.getData();
      const sniffed = sniffImage(mediaBuffer);
      if (!sniffed || !['png', 'jpg'].includes(sniffed.extension)) {
        result.ambiguous.push({
          reason: 'NON_PNG_IMAGE',
          detail: `Row ${spreadsheetRow}: embedded image is corrupt or unsupported; use PNG or JPEG`,
          rowNumber: spreadsheetRow,
        });
        continue;
      }

      const image: EmbeddedImage = {
        buffer: mediaBuffer,
        fileName: mediaPath.split('/').pop()!,
        rowNumber: spreadsheetRow,
        mediaPath,
        representation: 'legacy',
        sourceFormat: sniffed.extension as 'png' | 'jpg',
      };
      const column = Number(from['xdr:col']);
      if (Number.isInteger(column) && column >= 0 && column < 16384) {
        let n = column + 1;
        let letters = '';
        while (n > 0) {
          letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
          n = Math.floor((n - 1) / 26);
        }
        image.cellReference = `${letters}${spreadsheetRow}`;
      }
      const existing = result.imagesByRow.get(spreadsheetRow) ?? [];
      existing.push(image);
      result.imagesByRow.set(spreadsheetRow, existing);
    }

    return result;
  } finally {
    extractRichDataImages(zip, sheetPath, result);
  }
}

/** Fully decode source images, retaining native PNG bytes and normalizing JPEGs. */
export async function extractNormalizedEmbeddedImagesByRow(
  buffer: Buffer,
  sheet: number | string = 0,
): Promise<EmbeddedImageExtractionResult> {
  const result = extractEmbeddedImagesByRow(buffer, sheet);
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  for (const [row, images] of result.imagesByRow) {
    const valid: EmbeddedImage[] = [];
    for (const image of images) {
      try {
        if (image.buffer.length > 10 * 1024 * 1024) throw new Error('source image exceeds 10 MB');
        const decoder = sharp(image.buffer, { failOn: 'warning', limitInputPixels: 20_000_000 });
        const metadata = await decoder.metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          !['png', 'jpeg'].includes(metadata.format ?? '') ||
          (metadata.pages ?? 1) !== 1
        )
          throw new Error('unsupported format, dimensions or animated image');
        await decoder.clone().raw().toBuffer();
        const originalChecksum = hash(image.buffer);
        const normalized =
          metadata.format === 'jpeg' ? await decoder.png().toBuffer() : image.buffer;
        if (normalized.length > 10 * 1024 * 1024 || sniffImage(normalized)?.extension !== 'png')
          throw new Error('normalized PNG exceeds limits or is invalid');
        valid.push({
          ...image,
          buffer: normalized,
          fileName: image.fileName.replace(/\.[^.]+$/, '') + '.png',
          originalChecksum,
          normalizedChecksum: hash(normalized),
        });
      } catch (error) {
        result.ambiguous.push({
          reason: 'CORRUPT_IMAGE',
          rowNumber: row,
          detail: `Row ${row}, ${image.cellReference ?? image.fileName}: ${error instanceof Error ? error.message : 'image decode failed'}; replace the source picture with a valid PNG or JPEG`,
        });
      }
    }
    if (valid.length) result.imagesByRow.set(row, valid);
    else result.imagesByRow.delete(row);
  }
  return result;
}
