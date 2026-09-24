// AW25/SS26 historical PO-sheet parser. A controlled, template-specific
// parser (H1 plan corrected-review point: "keep the parser fail-closed and
// targeted to the observed AW25/SS26 layouts... do not add increasingly
// speculative heuristics just to force every file through automatically"),
// not a generalized PDF platform. Built and tuned against the real EI25001
// (AW25) and EI26001 (SS26) samples; a document that doesn't match the
// known anchors fails closed into PARTIAL/FAILED rather than guessing.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { TextLine } from './pdf-text-layout.js';
import { descriptionHeading, extractDocumentarySections } from './documentary-sections.js';
import { openPdfDocumentSession, type PdfDocumentSession } from './pdf-document-session.js';
import {
  sourceField,
  unknownField,
  type ParsedField,
  type ParsedPurchaseOrderRecord,
  type ParsedSizeQuantity,
  type ParseStatus,
} from './po-pdf-parser.types.js';

// The header info-grid packs several label/value columns onto the SAME
// visual row (e.g. "Erve India", "Supplier", "Season", "License Style",
// "Customer" are all one row at the same y) — so a *line* can never be
// matched wholesale against a single label string; only individual ITEMS
// within a line can. Anchoring is therefore always per-item.

/** How close (points) two stacked label items' x must be to be treated as one wrapped label (e.g. "Shipment" / "date" on separate lines). */
const LABEL_STACK_X_TOLERANCE = 8;
/** Max gap (points) between the label's x and the nearest value item's x — small in every observed case (0-5pt; the widest, the "invoices"->order-number anchor, is ~1pt). Large enough to tolerate minor template drift, small enough to never jump to a neighboring column on the same shared row. */
const MAX_LABEL_TO_VALUE_X_GAP = 40;
/** Max gap (points) between consecutive value items to still belong to the same value (word-spacing within one value, e.g. "336" + "rs / pcs", observed ~2pt). Kept tight because unrelated same-row neighbors can sit as little as ~5pt away — e.g. a wrapped label's second line ("date", from "Shipment"/"date") spilling into the Order date value's row on the SS26 template — and must never merge into the value. */
const MAX_VALUE_WORD_GAP = 4;

interface LabelAnchor {
  /** Index into the full lines array of the line the label ITEM sits on — the value is searched on the next line down. */
  lineIndex: number;
  x: number;
}

/** How many lines to look ahead (below) a reference line when searching for a related line — a label's own wrapped second line, or its value line. Small — just enough to skip an unrelated interleaved line (e.g. an address-block line sitting at an intermediate y between a header-grid label row and its value row), never far enough to reach an unrelated section. */
const MAX_LINE_LOOKAHEAD = 4;

function findLabelAnchor(lines: TextLine[], label: string): LabelAnchor | null {
  const normalized = label.trim().toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    // Exact match, or the label as a trailing whole word (some documents
    // glue an adjacent word onto the label with no space, e.g. "all
    // invoices" as one run when the label being searched for is
    // "invoices") — never a substring match, to avoid false positives.
    const item = lines[i]!.items.find((it) => {
      const text = it.text.trim().toLowerCase();
      return text === normalized || text.endsWith(` ${normalized}`);
    });
    if (item) return { lineIndex: i, x: item.x };
  }
  // Two-line wrapped label (e.g. "Shipment" / "date" as separate items,
  // not necessarily on the literal next line — an unrelated line, like an
  // address continuation, can sit between them at an intermediate y).
  const tokens = label.split(' ');
  if (tokens.length < 2) return null;
  const firstToken = tokens[0]!.toLowerCase();
  const restTokens = tokens.slice(1).join(' ').toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const topItem = lines[i]!.items.find((it) => it.text.trim().toLowerCase() === firstToken);
    if (!topItem) continue;
    for (let offset = 1; offset <= MAX_LINE_LOOKAHEAD; offset++) {
      const candidateLine = lines[i + offset];
      if (!candidateLine) break;
      const bottomItem = candidateLine.items.find(
        (it) => it.text.trim().toLowerCase() === restTokens && Math.abs(it.x - topItem.x) <= LABEL_STACK_X_TOLERANCE,
      );
      if (bottomItem) return { lineIndex: i + offset, x: bottomItem.x };
    }
  }
  return null;
}

/** Value = nearest item (by x) on the closest line below the label anchor that actually has something near its column, extended rightward while adjacent items sit close enough to still be one value. Skips over unrelated interleaved lines (e.g. the address block) rather than assuming the value is on the literal next line. */
function findLabelValue(lines: TextLine[], label: string): ParsedField<string> {
  const anchor = findLabelAnchor(lines, label);
  if (!anchor) return unknownField();

  let valueLine: TextLine | undefined;
  let nearest: TextLine['items'][number] | undefined;
  for (let offset = 1; offset <= MAX_LINE_LOOKAHEAD; offset++) {
    const candidateLine = lines[anchor.lineIndex + offset];
    if (!candidateLine) break;
    let candidateNearest: TextLine['items'][number] | undefined;
    for (const item of candidateLine.items) {
      if (!candidateNearest || Math.abs(item.x - anchor.x) < Math.abs(candidateNearest.x - anchor.x)) {
        candidateNearest = item;
      }
    }
    if (candidateNearest && Math.abs(candidateNearest.x - anchor.x) <= MAX_LABEL_TO_VALUE_X_GAP) {
      valueLine = candidateLine;
      nearest = candidateNearest;
      break;
    }
  }
  if (!valueLine || !nearest) return unknownField();

  const sortedByX = [...valueLine.items].sort((a, b) => a.x - b.x);
  const startIndex = sortedByX.indexOf(nearest);
  const collected = [nearest];
  let cursor = nearest;
  for (let i = startIndex + 1; i < sortedByX.length; i++) {
    const next = sortedByX[i]!;
    const gap = next.x - (cursor.x + cursor.width);
    if (gap > MAX_VALUE_WORD_GAP) break;
    collected.push(next);
    cursor = next;
  }
  const text = collected
    .map((item) => item.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sourceField(text || null);
}

const DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function parseDdMmYyyy(text: string | null): string | null {
  if (!text) return null;
  const match = DATE_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // ISO calendar date string (@db.Date semantics) — no timezone/time component.
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function extractUnitRate(rawValue: string | null): ParsedField<string> {
  if (!rawValue) return unknownField();
  const match = /(\d+(?:\.\d+)?)/.exec(rawValue);
  if (!match) return unknownField();
  return sourceField(match[1]!);
}

function extractCurrency(rawValue: string | null): ParsedField<string> {
  if (!rawValue) return unknownField();
  const trimmed = rawValue.trim();
  return trimmed ? sourceField(trimmed.toUpperCase()) : unknownField();
}

/** Some documents render the Season label glued directly onto its value with no space in between, as a single text run (e.g. "SeasonAW25") — the normal label/value pairing finds no separate value item, so this targets that specific pattern via the known season-code shape (two letters + two digits) rather than a generic heuristic. */
function extractSeasonWithGluedFallback(lines: TextLine[]): ParsedField<string> {
  const normal = findLabelValue(lines, 'Season');
  if (normal.value) return normal;
  for (const line of lines) {
    for (const item of line.items) {
      const match = /^season\s*([A-Za-z]{2}\d{2})$/i.exec(item.text.trim());
      if (match) return sourceField(match[1]!.toUpperCase());
    }
  }
  return unknownField();
}

function extractHsnCode(lines: TextLine[]): ParsedField<string> {
  const pattern = /\*?\s*HS\s+(\d{6,8})/i;
  for (const line of lines) {
    const match = pattern.exec(line.text);
    if (match) return sourceField(match[1]!);
  }
  return unknownField();
}

function extractAqlInspectionTerms(lines: TextLine[]): ParsedField<string> {
  const matches = lines.filter((line) => /AQL/i.test(line.text)).map((line) => line.text);
  return matches.length > 0 ? sourceField(matches.join(' | ')) : unknownField();
}

function extractApprovalSampleInstructions(lines: TextLine[]): ParsedField<string> {
  const startIndex = lines.findIndex((line) => line.text.trim().toLowerCase() === 'approval steps');
  if (startIndex === -1) return unknownField();
  const collected: string[] = [];
  const MAX_LINES = 10;
  for (let i = startIndex + 1; i < lines.length && collected.length < MAX_LINES; i++) {
    const text = lines[i]!.text.trim();
    if (!text) break;
    // Stop at the next section: a short heading line with no digits/colon
    // (e.g. the style-category title "Girl's Hoody") signals we've left the
    // approval-steps list, which is always "<label> : <detail>" shaped.
    if (!/[:\d]/.test(text) && text.split(' ').length <= 4) break;
    collected.push(text);
  }
  return collected.length > 0 ? sourceField(collected.join('\n')) : unknownField();
}

interface StyleSizeTableResult {
  styleName: ParsedField<string>;
  colour: ParsedField<string>;
  description: ParsedField<string>;
  /** The table's own Artwork column value — on most documents it's a reliable copy of the same LMIX code found in the header, and served (pre-H2A) as the last-resort fallback source for licenseStyleLmix on documents where the header grid's "License Style" label item is missing entirely. H2A discovered this copy can itself be stale/wrong (source-template copy/paste error — see EI26042 in po-pdf-parser.test.ts and h2a/lmix42026007-lmix42026010-investigation.md), so it is now only consulted after findStandaloneHeaderLmix also fails to find the header's own (unlabeled but present) value. */
  artwork: ParsedField<string>;
  /** The Style/Colour/Description/size table header row's own y position, so callers can distinguish "header region" (above this row — the info-grid, including any label-less orphaned LMIX value) from "table region" (this row and below, including the Artwork column) when a value could plausibly appear in either. Null when the table itself could not be located. */
  tableHeaderY: number | null;
  sizeQuantities: ParsedSizeQuantity[];
  tableTotalQuantity: ParsedField<number>;
  warnings: string[];
}

function extractStyleSizeTable(lines: TextLine[]): StyleSizeTableResult | null {
  const headerIndex = lines.findIndex(
    (line) => line.items[0]?.text === 'Style' && line.items.some((item) => item.text === 'Total'),
  );
  if (headerIndex === -1) return null;
  const headerItems = lines[headerIndex]!.items;
  const styleCol = headerItems.find((item) => item.text === 'Style');
  const colourCol = headerItems.find((item) => item.text === 'Colour');
  const descCol = headerItems.find((item) => item.text === 'Description');
  const artworkCol = headerItems.find((item) => item.text === 'Artwork');
  // "Extra artwork" renders as one combined header item on some documents
  // and as a split "Extra" / "artwork" (two lines) on others — match either.
  const extraCol = headerItems.find((item) => /^extra\b/i.test(item.text));
  const totalCol = headerItems.find((item) => item.text === 'Total');
  if (!styleCol || !colourCol || !descCol || !totalCol) return null;

  // Size columns: whatever header items sit strictly between "Extra" (or
  // "Artwork" if there's no "Extra artwork" column on this template) and
  // "Total" — never assumed to be a fixed set of sizes.
  const boundaryLeft = (extraCol ?? artworkCol ?? descCol).x;
  const sizeHeaderItems = headerItems
    .filter((item) => item.x > boundaryLeft + 1 && item.x < totalCol.x - 1)
    .sort((a, b) => a.x - b.x);

  type ColumnKey = 'style' | 'colour' | 'description' | 'artwork' | `size:${string}` | 'total';
  const columns: Array<{ key: ColumnKey; x: number }> = [
    { key: 'style' as ColumnKey, x: styleCol.x },
    { key: 'colour' as ColumnKey, x: colourCol.x },
    { key: 'description' as ColumnKey, x: descCol.x },
    ...(artworkCol ? [{ key: 'artwork' as ColumnKey, x: artworkCol.x }] : []),
    ...sizeHeaderItems.map((item) => ({ key: `size:${item.text}` as ColumnKey, x: item.x })),
    { key: 'total' as ColumnKey, x: totalCol.x },
  ].sort((a, b) => a.x - b.x);

  const boundaries = columns.map((col, i) => {
    const prevMid = i === 0 ? -Infinity : (columns[i - 1]!.x + col.x) / 2;
    const nextMid = i === columns.length - 1 ? Infinity : (col.x + columns[i + 1]!.x) / 2;
    return { key: col.key, lower: prevMid, upper: nextMid };
  });

  // Data region: everything below the header row down to (not including)
  // the next "Description" line — the free-text section heading that
  // always follows the single style/colour/size data row on this template.
  const nextDescriptionIndex = lines.findIndex((line, i) => i > headerIndex && line.items.some((item) => item.x < styleCol.x && descriptionHeading.test(item.text.trim())));
  // Include the heading's visual row: a table-cell continuation may share
  // its baseline. Exclude only the heading item itself from cell assignment.
  const headingItem = nextDescriptionIndex < 0 ? undefined : lines[nextDescriptionIndex]!.items.find((item) => item.x < styleCol.x && descriptionHeading.test(item.text.trim()));
  const dataLines = lines.slice(headerIndex + 1, nextDescriptionIndex === -1 ? undefined : nextDescriptionIndex + 1);

  const cellsByColumn = new Map<ColumnKey, { y: number; x: number; text: string }[]>();
  for (const line of dataLines) {
    for (const item of line.items) {
      if (item === headingItem) continue;
      const boundary = boundaries.find((b) => item.x >= b.lower && item.x < b.upper);
      if (!boundary) continue;
      const list = cellsByColumn.get(boundary.key) ?? [];
      list.push({ y: line.y, x: item.x, text: item.text });
      cellsByColumn.set(boundary.key, list);
    }
  }

  function joinedCell(key: ColumnKey): string | null {
    const cells = cellsByColumn.get(key);
    if (!cells || cells.length === 0) return null;
    const sorted = [...cells].sort((a, b) => (b.y === a.y ? a.x - b.x : b.y - a.y));
    const text = sorted
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text || null;
  }

  const warnings: string[] = [];
  // A single Job Order line's ordered quantity for one size on this
  // template is never remotely close to this — a sanity ceiling so a
  // column-boundary misclassification (an unrelated wrapped fragment, e.g.
  // part of an LMIX code, landing in a size column) fails closed into a
  // warning + UNKNOWN rather than silently producing an absurd quantity.
  const MAX_PLAUSIBLE_SIZE_QUANTITY = 100_000;
  const sizeQuantities: ParsedSizeQuantity[] = sizeHeaderItems.map((header) => {
    const raw = joinedCell(`size:${header.text}`);
    const quantity = raw ? Number.parseInt(raw.replace(/[^\d]/g, ''), 10) : NaN;
    if (raw && !Number.isFinite(quantity)) {
      warnings.push(`Could not parse quantity for size column "${header.text}": "${raw}"`);
      return { sizeCode: header.text, quantity: null };
    }
    if (Number.isFinite(quantity) && quantity > MAX_PLAUSIBLE_SIZE_QUANTITY) {
      warnings.push(`Implausible quantity for size column "${header.text}": "${raw}" (parsed ${quantity})`);
      return { sizeCode: header.text, quantity: null };
    }
    return { sizeCode: header.text, quantity: Number.isFinite(quantity) ? quantity : null };
  });

  const totalRaw = joinedCell('total');
  let tableTotalQuantity: ParsedField<number> = unknownField();
  if (totalRaw) {
    const match = /(\d[\d,]*)/.exec(totalRaw);
    if (match) {
      tableTotalQuantity = sourceField(Number.parseInt(match[1]!.replace(/,/g, ''), 10));
    } else {
      warnings.push(`Could not parse the table Total cell: "${totalRaw}"`);
    }
  }

  return {
    styleName: sourceField(joinedCell('style')),
    colour: sourceField(joinedCell('colour')),
    description: sourceField(joinedCell('description')),
    artwork: sourceField(joinedCell('artwork')),
    tableHeaderY: lines[headerIndex]!.y,
    sizeQuantities,
    tableTotalQuantity,
    warnings,
  };
}

/** "LMIX" + any non-space run, as the item's ENTIRE trimmed text — never a substring match — so this never mistakes e.g. a sentence mentioning "LMIX" for a standalone code. */
const STANDALONE_LMIX_PATTERN = /^LMIX\S*$/i;

/**
 * Finds a standalone LMIX-shaped text item positioned in the header/info-grid
 * region of the page (strictly above the Style/Colour/Description table),
 * independent of whether an adjacent "License Style"/"License" label text
 * item exists nearby to anchor it to (H2A: confirmed genuinely absent from
 * the content stream on a real subset of documents — see the EI26041-EI26050
 * block in po-pdf-parser.test.ts — not a parser anchoring failure). This is
 * the document's own header value, distinct from (and, per H2A's EI26042
 * finding, occasionally more trustworthy than) the table's Artwork-column
 * copy of the same code. Deliberately conservative: if more than one
 * distinct standalone LMIX value is found in the header region, this fails
 * closed to unknownField() rather than guessing which one is authoritative.
 */
function findStandaloneHeaderLmix(lines: TextLine[], tableHeaderY: number | null): ParsedField<string> {
  const found = new Set<string>();
  for (const line of lines) {
    // The header/info-grid sits strictly above the table header row on this
    // template (higher y — pdf-text-layout.ts's TextItem y grows upward).
    if (tableHeaderY !== null && line.y <= tableHeaderY) continue;
    for (const item of line.items) {
      const text = item.text.trim();
      if (STANDALONE_LMIX_PATTERN.test(text)) found.add(text.toUpperCase());
    }
  }
  if (found.size === 1) return sourceField([...found][0]!);
  return unknownField();
}

function extractHeaderTotalQty(lines: TextLine[]): ParsedField<number> {
  const raw = findLabelValue(lines, 'Total qty');
  if (!raw.value) return unknownField();
  const match = /(\d[\d,]*)/.exec(raw.value);
  return match ? sourceField(Number.parseInt(match[1]!.replace(/,/g, ''), 10)) : unknownField();
}

export interface ParsePurchaseOrderPdfOptions {
  /** Absolute path on disk, used only for basename/relative-path bookkeeping. */
  filePath: string;
  /** Path relative to the source-folder root the file was found under, for the manifest/staging output. */
  relativePath: string;
  sourceSeasonFolder: 'AW25' | 'SS26';
}

export interface ParsePurchaseOrderBufferOptions {
  fileBuffer: Buffer;
  sourceFileName: string;
  relativePath: string;
  sourceSizeBytes: number;
  sourceSeasonFolder: 'AW25' | 'SS26';
}

/** The parser's actual core — bytes in, record out, no filesystem access. `parsePurchaseOrderPdf` below is the thin disk-reading wrapper prepare/dry-run use; tests exercise this directly against synthetic in-memory PDFs (H1 plan §23 — real historic PDFs are never committed as fixtures). */
/** The parser's field-extraction logic given an already-open pdfjs session — takes no bytes and does no pdfjs I/O itself, so it composes safely with the image extractor sharing the SAME session (see pdf-document-session.ts's module comment for why a second session per file must be avoided). */
export function parsePurchaseOrderFromSession(
  session: Pick<PdfDocumentSession, 'pageCount' | 'layout'>,
  meta: { checksum: string; sourceFileName: string; relativePath: string; sourceSizeBytes: number; sourceSeasonFolder: 'AW25' | 'SS26' },
): ParsedPurchaseOrderRecord {
  const warnings: string[] = [];
  const { pageCount, layout } = session;

  const base: Omit<
    ParsedPurchaseOrderRecord,
    | 'parseStatus'
    | 'legacyReferenceNumber'
    | 'documentSeason'
    | 'seasonFolderMismatch'
    | 'factoryName'
    | 'licenseStyleLmix'
    | 'styleName'
    | 'colour'
    | 'description'
    | 'hsnCode'
    | 'orderDate'
    | 'shipmentDate'
    | 'unitRate'
    | 'currency'
    | 'paymentTerms'
    | 'approvalSampleInstructions'
    | 'aqlInspectionTerms'
    | 'sizeQuantities'
    | 'tableTotalQuantity'
    | 'headerTotalQuantity'
    | 'quantitySumMatchesTotal'
  > = {
    sourceFileName: meta.sourceFileName,
    sourceRelativePath: meta.relativePath,
    sourceChecksumSha256: meta.checksum,
    sourceSizeBytes: meta.sourceSizeBytes,
    sourceSeasonFolder: meta.sourceSeasonFolder,
    warnings,
  };

  if (pageCount !== 1) {
    warnings.push(`Expected a single-page PO sheet, found ${pageCount} pages — outside the known AW25/SS26 template`);
  }

  const lines = layout.lines;
  const documentarySections = extractDocumentarySections(layout, pageCount);

  const legacyReferenceNumber = findLabelValue(lines, 'invoices');
  const documentSeason = extractSeasonWithGluedFallback(lines);
  const factoryName = findLabelValue(lines, 'Supplier');
  const orderDateRaw = findLabelValue(lines, 'Order date');
  const shipmentDateRaw = findLabelValue(lines, 'Shipment date');
  const unitRate = extractUnitRate(findLabelValue(lines, 'Suppliers cp').value);
  const currency = extractCurrency(findLabelValue(lines, 'Curr').value);
  const paymentTerms = findLabelValue(lines, 'Payment terms');
  const hsnCode = extractHsnCode(lines);
  const aqlInspectionTerms = extractAqlInspectionTerms(lines);
  const approvalSampleInstructions = extractApprovalSampleInstructions(lines);
  const headerTotalQuantity = extractHeaderTotalQty(lines);

  const table = extractStyleSizeTable(lines);
  warnings.push(...(table?.warnings ?? []));
  if (!table) warnings.push('Could not locate the Style/Colour/Description/size table on this page');

  // Precedence (H2A: fixed after the EI26042 anomaly — see
  // findStandaloneHeaderLmix's own comment and h2a/lmix42026007-
  // lmix42026010-investigation.md): explicit header LMIX (by label anchor,
  // or — on a minority of documents where the "License Style" label item is
  // entirely absent from the content stream, a source-document rendering
  // gap, not a parser miss — the header's own unlabeled standalone value)
  // always wins over the table's Artwork-column copy. The Artwork column is
  // now a LAST-RESORT fallback only, used when a valid header LMIX is
  // genuinely absent by both routes — H2A found it can itself be a stale
  // copy/paste artifact from a neighboring order (EI26042), not always a
  // reliable duplicate of the header value as previously assumed.
  const licenseStyleLmixHeader = findLabelValue(lines, 'License Style');
  const licenseStyleLmixStandaloneHeader = findStandaloneHeaderLmix(lines, table?.tableHeaderY ?? null);
  const licenseStyleLmix: ParsedField<string> = licenseStyleLmixHeader.value
    ? licenseStyleLmixHeader
    : licenseStyleLmixStandaloneHeader.value
      ? licenseStyleLmixStandaloneHeader
      : (() => {
          const artworkMatch = table?.artwork.value ? /LMIX\S*/i.exec(table.artwork.value) : null;
          return artworkMatch ? sourceField(artworkMatch[0].toUpperCase()) : unknownField();
        })();

  const orderDate = sourceField(parseDdMmYyyy(orderDateRaw.value));
  if (orderDateRaw.value && !orderDate.value) warnings.push(`Unrecognized order date format: "${orderDateRaw.value}"`);
  const shipmentDate = sourceField(parseDdMmYyyy(shipmentDateRaw.value));
  if (shipmentDateRaw.value && !shipmentDate.value)
    warnings.push(`Unrecognized shipment date format: "${shipmentDateRaw.value}"`);

  const sizeQuantities = table?.sizeQuantities ?? [];
  const tableTotalQuantity = table?.tableTotalQuantity ?? unknownField();
  let quantitySumMatchesTotal: boolean | null = null;
  if (tableTotalQuantity.value !== null && sizeQuantities.length > 0 && sizeQuantities.every((s) => s.quantity !== null)) {
    const sum = sizeQuantities.reduce((acc, s) => acc + (s.quantity ?? 0), 0);
    quantitySumMatchesTotal = sum === tableTotalQuantity.value;
    if (!quantitySumMatchesTotal) {
      warnings.push(`Size quantities sum to ${sum} but the table Total reads ${tableTotalQuantity.value}`);
    }
  }
  if (
    headerTotalQuantity.value !== null &&
    tableTotalQuantity.value !== null &&
    headerTotalQuantity.value !== tableTotalQuantity.value
  ) {
    warnings.push(
      `Header "Total qty" (${headerTotalQuantity.value}) disagrees with the table Total (${tableTotalQuantity.value})`,
    );
  }

  const seasonFolderMismatch =
    documentSeason.value !== null && documentSeason.value.trim().toUpperCase() !== meta.sourceSeasonFolder;
  if (seasonFolderMismatch) {
    warnings.push(
      `Document Season reads "${documentSeason.value}" but this file was supplied under --${meta.sourceSeasonFolder.toLowerCase()}-dir`,
    );
  }

  const criticalFields: Array<[string, ParsedField<unknown>]> = [
    ['legacyReferenceNumber', legacyReferenceNumber],
    ['documentSeason', documentSeason],
    ['factoryName', factoryName],
    ['licenseStyleLmix', licenseStyleLmix],
    ['orderDate', orderDate],
    ['unitRate', unitRate],
    ['headerTotalQuantity', headerTotalQuantity],
  ];
  for (const [name, field] of criticalFields) {
    if (field.value === null) warnings.push(`Could not extract required field: ${name}`);
  }
  const missingCriticalCount = criticalFields.filter(([, field]) => field.value === null).length;
  const hasTable = table !== null && sizeQuantities.length > 0;

  let parseStatus: ParseStatus;
  if (pageCount !== 1 || !hasTable || missingCriticalCount >= criticalFields.length) {
    parseStatus = 'FAILED';
  } else if (missingCriticalCount > 0 || warnings.length > 0) {
    parseStatus = 'PARTIAL';
  } else {
    parseStatus = 'OK';
  }

  return {
    ...base,
    parseStatus,
    legacyReferenceNumber,
    documentSeason,
    seasonFolderMismatch,
    factoryName,
    licenseStyleLmix,
    styleName: documentarySections.reviewReasons.length ? table?.styleName ?? unknownField() : sourceField(documentarySections.tableStyleName),
    colour: table?.colour ?? unknownField(),
    description: documentarySections.reviewReasons.length ? table?.description ?? unknownField() : sourceField(documentarySections.styleDescription),
    documentarySections,
    hsnCode,
    orderDate,
    shipmentDate,
    unitRate,
    currency,
    paymentTerms,
    approvalSampleInstructions: documentarySections.reviewReasons.length ? approvalSampleInstructions : sourceField(documentarySections.approvalText),
    aqlInspectionTerms,
    sizeQuantities,
    tableTotalQuantity,
    headerTotalQuantity,
    quantitySumMatchesTotal,
  };
}

function failedParseRecord(
  base: Omit<
    ParsedPurchaseOrderRecord,
    | 'parseStatus'
    | 'legacyReferenceNumber'
    | 'documentSeason'
    | 'seasonFolderMismatch'
    | 'factoryName'
    | 'licenseStyleLmix'
    | 'styleName'
    | 'colour'
    | 'description'
    | 'hsnCode'
    | 'orderDate'
    | 'shipmentDate'
    | 'unitRate'
    | 'currency'
    | 'paymentTerms'
    | 'approvalSampleInstructions'
    | 'aqlInspectionTerms'
    | 'sizeQuantities'
    | 'tableTotalQuantity'
    | 'headerTotalQuantity'
    | 'quantitySumMatchesTotal'
  >,
): ParsedPurchaseOrderRecord {
  return {
    ...base,
    parseStatus: 'FAILED',
    legacyReferenceNumber: unknownField(),
    documentSeason: unknownField(),
    seasonFolderMismatch: false,
    factoryName: unknownField(),
    licenseStyleLmix: unknownField(),
    styleName: unknownField(),
    colour: unknownField(),
    description: unknownField(),
    hsnCode: unknownField(),
    orderDate: unknownField(),
    shipmentDate: unknownField(),
    unitRate: unknownField(),
    currency: unknownField(),
    paymentTerms: unknownField(),
    approvalSampleInstructions: unknownField(),
    aqlInspectionTerms: unknownField(),
    sizeQuantities: [],
    tableTotalQuantity: unknownField(),
    headerTotalQuantity: unknownField(),
    quantitySumMatchesTotal: null,
  };
}

/** Opens exactly one pdfjs session for these bytes, parses, and closes it — the standalone entry point for parsing alone (tests, or any caller that doesn't also need the image extractor). The combined prepare pipeline instead opens one session and calls parsePurchaseOrderFromSession + extractStyleImageCandidate against it directly. */
export async function parsePurchaseOrderBuffer(options: ParsePurchaseOrderBufferOptions): Promise<ParsedPurchaseOrderRecord> {
  const { fileBuffer } = options;
  const checksum = createHash('sha256').update(fileBuffer).digest('hex');
  const meta = {
    checksum,
    sourceFileName: options.sourceFileName,
    relativePath: options.relativePath,
    sourceSizeBytes: options.sourceSizeBytes,
    sourceSeasonFolder: options.sourceSeasonFolder,
  };

  let session: PdfDocumentSession;
  try {
    session = await openPdfDocumentSession(new Uint8Array(fileBuffer));
  } catch (error) {
    return failedParseRecord({
      sourceFileName: meta.sourceFileName,
      sourceRelativePath: meta.relativePath,
      sourceChecksumSha256: checksum,
      sourceSizeBytes: meta.sourceSizeBytes,
      sourceSeasonFolder: meta.sourceSeasonFolder,
      warnings: [`Unreadable/corrupt PDF: ${error instanceof Error ? error.message : String(error)}`],
    });
  }
  try {
    return parsePurchaseOrderFromSession(session, meta);
  } finally {
    await session.destroy();
  }
}

/** Disk-reading wrapper around parsePurchaseOrderBuffer — what the prepare/dry-run CLIs actually call. */
export async function parsePurchaseOrderPdf(options: ParsePurchaseOrderPdfOptions): Promise<ParsedPurchaseOrderRecord> {
  const fileBuffer = await readFile(options.filePath);
  const fileStat = await stat(options.filePath);
  return parsePurchaseOrderBuffer({
    fileBuffer,
    sourceFileName: basename(options.filePath),
    relativePath: options.relativePath,
    sourceSizeBytes: fileStat.size,
    sourceSeasonFolder: options.sourceSeasonFolder,
  });
}
