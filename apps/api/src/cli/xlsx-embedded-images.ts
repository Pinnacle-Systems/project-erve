// Reads PNG images embedded (anchored) in an .xlsx workbook's first sheet,
// resolved to the spreadsheet row each one is anchored to. The `xlsx`
// (SheetJS) package already used elsewhere in this CLI suite only reads
// cell text/values — it has no concept of embedded drawings — so this reads
// the workbook's underlying OOXML (an .xlsx file is a zip archive) directly:
// workbook.xml -> the first sheet's relationship -> that sheet's drawing
// relationship -> the drawing's anchors -> each anchor's image relationship
// -> the actual media file.
//
// Deliberately conservative: any anchor that doesn't resolve to exactly one
// row and one valid PNG is reported in `ambiguous` and never guessed at —
// callers must treat those rows as rejected, not silently skipped or
// attached to the wrong Style.
import path from 'node:path';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';
import { sniffImage } from '../storage/image-sniff.js';

// OOXML relationship Targets are relative to the directory containing the
// .rels file's OWNER (not the .rels file itself), and routinely use "../"
// to reach a sibling directory (e.g. a sheet's drawing relationship, or a
// drawing's own image relationships) — naive string prepending breaks on
// those; this resolves and normalizes properly, the same way a browser
// resolves a relative URL.
function resolveRelationshipTarget(ownerDir: string, target: string): string {
  return path.posix.normalize(path.posix.join(ownerDir, target));
}

export interface EmbeddedImage {
  buffer: Buffer;
  fileName: string;
  /** 1-indexed spreadsheet row this image is anchored to (header is row 1 — same convention the sheet-row reader uses). */
  rowNumber: number;
}

export interface EmbeddedImageAmbiguity {
  reason:
    | 'UNSUPPORTED_ANCHOR_SHAPE'
    | 'UNPARSEABLE_ROW'
    | 'NO_IMAGE_REFERENCE'
    | 'UNRESOLVED_IMAGE_REFERENCE'
    | 'MISSING_MEDIA_FILE'
    | 'NON_PNG_IMAGE';
  detail: string;
  /** The 1-indexed spreadsheet row this ambiguity is attributable to, when known — absent for UNSUPPORTED_ANCHOR_SHAPE/UNPARSEABLE_ROW, where the row itself couldn't be determined. */
  rowNumber?: number;
}

export interface EmbeddedImageExtractionResult {
  imagesByRow: Map<number, EmbeddedImage[]>;
  ambiguous: EmbeddedImageAmbiguity[];
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
}

interface OoxmlSheetRef {
  'r:id'?: string;
  id?: string;
}

interface OoxmlAnchor {
  'xdr:from'?: { 'xdr:row'?: unknown };
  'xdr:pic'?: { 'xdr:blipFill'?: { 'a:blip'?: { 'r:embed'?: string } } };
}

/**
 * Returns an empty result (no images, no ambiguities) for any input that
 * isn't a workbook with a readable drawing — that's the common, expected
 * case of "a sheet with no embedded images", not an error.
 */
export function extractEmbeddedImagesByRow(buffer: Buffer, sheetIndex = 0): EmbeddedImageExtractionResult {
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

  const sheets = asArray<OoxmlSheetRef>(get(workbookXml, ['workbook', 'sheets', 'sheet']) as OoxmlSheetRef | OoxmlSheetRef[] | undefined);
  const targetSheet = sheets[sheetIndex];
  if (!targetSheet) return result;
  const sheetRid = targetSheet['r:id'] ?? targetSheet.id;
  const workbookRelationships = asArray<OoxmlRelationship>(
    get(workbookRels, ['Relationships', 'Relationship']) as OoxmlRelationship | OoxmlRelationship[] | undefined,
  );
  const sheetRel = workbookRelationships.find((rel) => rel.Id === sheetRid);
  if (!sheetRel?.Target) return result;

  const sheetPath = resolveRelationshipTarget('xl', sheetRel.Target);
  const sheetDir = path.posix.dirname(sheetPath);
  const sheetFileName = path.posix.basename(sheetPath);
  const sheetRelsXml = readXml(zip, path.posix.join(sheetDir, `_rels/${sheetFileName}.rels`));
  if (!sheetRelsXml) return result;

  const sheetRelationships = asArray<OoxmlRelationship>(
    get(sheetRelsXml, ['Relationships', 'Relationship']) as OoxmlRelationship | OoxmlRelationship[] | undefined,
  );
  const drawingRel = sheetRelationships.find((rel) => String(rel.Type).endsWith('/drawing'));
  if (!drawingRel?.Target) return result;

  const drawingPath = resolveRelationshipTarget(sheetDir, drawingRel.Target);
  const drawingDir = path.posix.dirname(drawingPath);
  const drawingFileName = path.posix.basename(drawingPath);
  const drawingXml = readXml(zip, drawingPath);
  const drawingRelsXml = readXml(zip, path.posix.join(drawingDir, `_rels/${drawingFileName}.rels`));
  if (!drawingXml || !drawingRelsXml) return result;

  const mediaByRid = new Map<string, string>();
  const drawingRelationships = asArray<OoxmlRelationship>(
    get(drawingRelsXml, ['Relationships', 'Relationship']) as OoxmlRelationship | OoxmlRelationship[] | undefined,
  );
  for (const rel of drawingRelationships) {
    if (rel.Id && rel.Target && String(rel.Type).endsWith('/image')) {
      mediaByRid.set(rel.Id, resolveRelationshipTarget(drawingDir, rel.Target));
    }
  }

  const wsDr = get(drawingXml, ['xdr:wsDr']) as Record<string, unknown> | undefined;
  if (!wsDr) return result;
  const anchors = [
    ...asArray<OoxmlAnchor>(wsDr['xdr:twoCellAnchor'] as OoxmlAnchor | OoxmlAnchor[] | undefined),
    ...asArray<OoxmlAnchor>(wsDr['xdr:oneCellAnchor'] as OoxmlAnchor | OoxmlAnchor[] | undefined),
  ];

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
      result.ambiguous.push({ reason: 'UNPARSEABLE_ROW', detail: 'Could not read the anchor row for an embedded image' });
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
    if (!sniffed || sniffed.extension !== 'png') {
      result.ambiguous.push({
        reason: 'NON_PNG_IMAGE',
        detail: `Row ${spreadsheetRow}: embedded image is not a valid PNG`,
        rowNumber: spreadsheetRow,
      });
      continue;
    }

    const image: EmbeddedImage = {
      buffer: mediaBuffer,
      fileName: mediaPath.split('/').pop()!,
      rowNumber: spreadsheetRow,
    };
    const existing = result.imagesByRow.get(spreadsheetRow) ?? [];
    existing.push(image);
    result.imagesByRow.set(spreadsheetRow, existing);
  }

  return result;
}
