import { linesFromItems, type PageLayout, type TextItem } from './pdf-text-layout.js';

export interface DocumentarySections {
  version: 'H2B.1';
  /** Physical PDF lines in the single Description table cell, for audit. */
  tableDescriptionRaw: string;
  tableDescription: string;
  tableStyleName: string;
  specificationText: string;
  styleDescription: string;
  approvalText: string;
  orderInstructionText?: string;
  disclaimerText: string;
  jobOrderDisclaimer: string;
  reviewReasons: string[];
  boundaries: Record<string, number>;
  /** Complete neighboring text and coordinates, including ambiguous material. */
  layoutEvidence?: PageLayout;
}

// Match items, not entire rows: EI25035's misspelled heading shares the
// final description cell's baseline. Starred specifications are retained.
export const descriptionHeading = /^Descri(?:p)?tion\s*:?$/i;
const commercialStart = /^\*For detailed Trims and Accessories\b/;
const commercialClause = /^\*(?:For detailed Trims and Accessories\b|Any delay\b|100% AQL\b|Delivery date\b)/;
function text(items: TextItem[]): string {
  return linesFromItems(items).map((line) => line.text).join('\n').trim();
}

/** Template-specific structural extraction. Coordinates establish table,
 * title and approval regions. Semantic anchors distinguish adjacent stanzas
 * in the unruled lower block. Unknown text requires review, never deletion.
 * The season is deliberately not an input; absent clauses stay absent.
 */
export function extractDocumentarySections(layout: PageLayout, pageCount = 1): DocumentarySections {
  const result: DocumentarySections = {
    version: 'H2B.1', tableDescriptionRaw: '', tableDescription: '', tableStyleName: '', specificationText: '', styleDescription: '',
    approvalText: '', disclaimerText: '', jobOrderDisclaimer: '', reviewReasons: [], boundaries: {}, layoutEvidence: layout,
  };
  const review = (reason: string) => result.reviewReasons.push(reason);
  if (pageCount !== 1) review('Expected one source page');
  const lines = layout.lines;
  const headers = lines.filter((l) => l.items.some((i) => i.text === 'Style') && l.items.some((i) => i.text === 'Total'));
  if (headers.length !== 1) { review('Style table header is not unique'); return result; }
  const header = headers[0]!;
  const desc = header.items.find((i) => i.text === 'Description');
  const styleColumn = header.items.find((i) => i.text === 'Style');
  const colourColumn = header.items.find((i) => i.text === 'Colour');
  const artwork = header.items.find((i) => i.text === 'Artwork');
  const items = lines.flatMap((l) => l.items);
  const headings = items.filter((i) => i.y < header.y && descriptionHeading.test(i.text.trim()) && i.x < (desc?.x ?? 0) - 10);
  const approvals = items.filter((i) => i.text.trim() === 'Approval steps' && i.y > header.y);
  if (!desc || !styleColumn || !colourColumn || !artwork || headings.length !== 1 || approvals.length !== 1) {
    review('Missing or ambiguous table, lower Description, or Approval steps anchor'); return result;
  }
  const heading = headings[0]!;
  const approval = approvals[0]!;
  const instructions = lines.filter((l) => l.y > approval.y && l.y < approval.y + 25 && l.text.startsWith('FOR ALL ADDITIONAL ORDER DETAILS'));
  if (instructions.length > 1) review('Ambiguous order-detail instruction above approval heading');
  result.orderInstructionText = instructions.map((l) => l.text).join('\n');
  const title = lines[lines.indexOf(header) - 1];
  if (!title || title.y >= approval.y || title.items.length !== 1 || Math.abs(title.items[0]!.x - approval.x) > 5) {
    review('Cannot demonstrate the title row closing the approval region'); return result;
  }
  result.boundaries = { approvalHeadingY: approval.y, approvalBottomY: title.y, tableHeaderY: header.y,
    descriptionColumnX: desc.x, descriptionColumnRightX: artwork.x, lowerHeadingY: heading.y, lowerHeadingX: heading.x };
  result.approvalText = text(items.filter((i) => i.y < approval.y - 2.5 && i.y > title.y + 2.5 && i.x < layout.width * 0.6));
  result.tableDescriptionRaw = text(items.filter((i) => i.y < header.y - 2.5 && i.y >= heading.y - 2.5 && Math.abs(i.x - desc.x) < 5));
  // These consecutive lines occupy one visual table cell. Their newlines
  // come from the column width; retain actual PDF lines in audit evidence.
  result.tableDescription = result.tableDescriptionRaw.replace(/\s*\n\s*/g, ' ');
  result.tableStyleName = items.filter((i) => i.y < header.y - 2.5 && i.y >= heading.y - 2.5 && i.x >= styleColumn.x - 12 && i.x < (styleColumn.x + colourColumn.x) / 2 && i !== heading)
    .sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
  const lower = linesFromItems(items.filter((i) => i.y < heading.y - 2.5));
  const starts = lower.map((l, index) => commercialStart.test(l.text) ? index : -1).filter((i) => i >= 0);
  if (starts.length !== 1) { review('Commercial stanza start is missing or ambiguous'); return result; }
  const start = starts[0]!;
  const specs = lower.slice(0, start);
  const clauses = lower.slice(start);
  if (!specs.length || specs.some((l) => !l.text.startsWith('*') || Math.abs(l.items[0]!.x - heading.x) > 5)) review('Unrecognized specification stanza layout');
  if (clauses.some((l) => !commercialClause.test(l.text) || Math.abs(l.items[0]!.x - heading.x) > 5)) review('Unrecognized commercial clause or neighboring footer; inspect source');
  if (!result.tableDescription || !result.tableStyleName || !result.approvalText) review('Empty description, style name, or approval region');
  result.boundaries.commercialTopY = clauses[0]!.y;
  result.boundaries.commercialBottomY = clauses.at(-1)!.y;
  result.specificationText = specs.map((l) => l.text).join('\n');
  result.disclaimerText = clauses.map((l) => l.text).join('\n');
  result.styleDescription = [result.tableDescription, result.specificationText].filter(Boolean).join('\n\n');
  result.jobOrderDisclaimer = [result.orderInstructionText, result.approvalText, result.disclaimerText].filter(Boolean).join('\n\n');
  return result;
}

export type PdfMrpClassification = 'PDF_MRP_EXACT' | 'PDF_MRP_EQUIVALENT' | 'PDF_HAS_ADDITIONAL_CONTENT' | 'MRP_HAS_ADDITIONAL_CONTENT' | 'PDF_MRP_DIFFER';
export function comparePdfMrp(pdf: string, mrp: string): PdfMrpClassification {
  if (pdf === mrp) return 'PDF_MRP_EXACT';
  const p = pdf.replace(/\s+/g, ' ').trim();
  const m = mrp.replace(/\s+/g, ' ').trim();
  if (p === m) return 'PDF_MRP_EQUIVALENT';
  if (m && p.includes(m)) return 'PDF_HAS_ADDITIONAL_CONTENT';
  if (p && m.includes(p)) return 'MRP_HAS_ADDITIONAL_CONTENT';
  return 'PDF_MRP_DIFFER';
}

export function requireDocumentarySections(sections: DocumentarySections | undefined): DocumentarySections {
  if (!sections || sections.version !== 'H2B.1' || sections.reviewReasons.length || !sections.styleDescription || !sections.jobOrderDisclaimer) {
    throw new Error(`REVIEW_REQUIRED: ${sections?.reviewReasons.join('; ') || 'Re-extract source PDF documentary sections with H2B.1'}`);
  }
  return sections;
}
