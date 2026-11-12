import { pdf } from '@react-pdf/renderer';
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

/** One rendered text run (react-pdf emits one run per wrapped line of a `<Text>`). */
export interface PdfTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Glyph box height as reported by pdfjs (~ the font size). */
  height: number;
}

/** Where an image is painted on a page (PDF points, origin bottom-left). */
export interface PdfImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export interface InspectedPdf {
  numPages: number;
  /** Painted image boxes per page, including the header logo. */
  imagesByPage: PdfImagePlacement[][];
  /** Page size in PDF points, per page. */
  pageSizes: { width: number; height: number }[];
  runsByPage: PdfTextRun[][];
  /** All runs, whitespace-normalised, joined in reading order. */
  fullText: string;
}

/** Page side padding the shared `PdfDocument` shell applies (`paddingHorizontal: 28`). */
export const PDF_PAGE_SIDE_PADDING = 28;

/**
 * Renders a react-pdf document and reads it back with pdfjs (same Node-legacy-build pattern as the
 * other PDF tests), so assertions are made on the real laid-out page — not on view-model strings.
 */
export async function renderAndInspectPdf(element: ReactElement): Promise<InspectedPdf> {
  const blob = await pdf(element as Parameters<typeof pdf>[0]).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const doc = await task.promise;
    const runsByPage: PdfTextRun[][] = [];
    const pageSizes: InspectedPdf['pageSizes'] = [];
    const imagesByPage: PdfImagePlacement[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pageSizes.push({ width: page.view[2]!, height: page.view[3]! });
      const operators = await page.getOperatorList();
      const images: PdfImagePlacement[] = [];
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      operators.fnArray.forEach((fn, opIndex) => {
        const args = operators.argsArray[opIndex] as unknown;
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        else if (fn === OPS.paintImageXObject) {
          images.push({ x: ctm[4], y: ctm[5], width: Math.abs(ctm[0]), height: Math.abs(ctm[3]) });
        }
      });
      imagesByPage.push(images);
      const content = await page.getTextContent();
      runsByPage.push(
        content.items.flatMap((item) =>
          'str' in item && item.str.trim()
            ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width, height: item.height }]
            : [],
        ),
      );
    }
    const fullText = runsByPage
      .map((runs) => runs.map((run) => run.str).join(' '))
      .join('\n')
      .replace(/\s+/g, ' ');
    return { numPages: doc.numPages, pageSizes, runsByPage, imagesByPage, fullText };
  } finally {
    await task.destroy();
  }
}

/**
 * Every whitespace-separated word of `text` must appear whole inside a single rendered run. A word
 * that was split across two lines (mid-word hyphenation, "Ra-" / "jasthan") exists in no single run.
 */
export function expectWordsIntact(inspected: InspectedPdf, text: string): void {
  const runs = inspected.runsByPage.flat().map((run) => run.str);
  for (const word of text.split(/\s+/).filter(Boolean)) {
    expect(
      runs.some((run) => run.includes(word)),
      `word "${word}" was split or dropped`,
    ).toBe(true);
  }
}

/** No two runs on the same baseline may overlap horizontally (adjacent fields colliding). */
export function expectNoHorizontalOverlap(inspected: InspectedPdf): void {
  for (const runs of inspected.runsByPage) {
    for (let a = 0; a < runs.length; a++) {
      for (let b = a + 1; b < runs.length; b++) {
        const first = runs[a]!;
        const second = runs[b]!;
        if (Math.abs(first.y - second.y) < 1) {
          const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
          expect(overlap, `"${first.str}" / "${second.str}" overlap`).toBeLessThanOrEqual(0.7);
        }
      }
    }
  }
}

/** No run may extend past the page's printable area (right padding) — i.e. nothing is clipped. */
export function expectWithinPrintableWidth(inspected: InspectedPdf): void {
  inspected.runsByPage.forEach((runs, index) => {
    const limit = inspected.pageSizes[index]!.width - PDF_PAGE_SIDE_PADDING + 1;
    for (const run of runs) {
      expect(run.x, `"${run.str}" starts left of the margin`).toBeGreaterThanOrEqual(PDF_PAGE_SIDE_PADDING - 1);
      expect(run.x + run.width, `"${run.str}" runs past the right margin`).toBeLessThanOrEqual(limit);
    }
  });
}

/**
 * Realistic long Indian Store/address data (synthetic — not customer data). The words that used to
 * be hyphenated mid-word ("Ra-jasthan", "Col-lectorate") are all present.
 */
export const LONG_INDIAN_STORE_FIXTURE = {
  label: 'Sri Ganesh Readymade Garments And Family Emporium (Rajasthan Franchise Outlet)',
  addressLine1: 'Shop No. 14-B, Ground Floor, Maharaja Agrasen Commercial Complex',
  addressLine2: 'Opposite Collectorate Circle, Near Rajasthan Roadways Bus Stand, Sardarpura Extension',
  city: 'Jodhpur',
  state: 'Rajasthan',
  postalCode: '342001',
  country: 'India',
  contactName: 'Mahendra Singh Rathore',
  contactPhone: '9876543210',
} as const;

/** The destination address exactly as the document builders join it. */
export const LONG_INDIAN_ADDRESS_TEXT = [
  LONG_INDIAN_STORE_FIXTURE.addressLine1,
  LONG_INDIAN_STORE_FIXTURE.addressLine2,
  LONG_INDIAN_STORE_FIXTURE.city,
  LONG_INDIAN_STORE_FIXTURE.state,
  LONG_INDIAN_STORE_FIXTURE.postalCode,
  LONG_INDIAN_STORE_FIXTURE.country,
].join(', ');

/** Vertical page reservations of the shared `PdfDocument` portrait shell (`paddingTop: 72`, `paddingBottom: 44`). */
export const PDF_PORTRAIT_TOP_PADDING = 72;
export const PDF_PORTRAIT_BOTTOM_PADDING = 44;

const stripForMatch = (text: string) => text.replace(/[\s\-\u2010\u2011\u2026.]/g, '');

export interface SplitPageChrome {
  header: PdfTextRun[];
  footer: PdfTextRun[];
  body: PdfTextRun[];
}

/**
 * Separates the fixed chrome from the body on one page. Header runs are the leading runs that spell out
 * (a prefix of) `headerText` — matched by content, not position, so a header that has wrongly grown past its
 * band is still recognised as header. Footer runs are the "Page X of Y" line.
 */
export function splitPageChrome(runs: PdfTextRun[], headerText: string): SplitPageChrome {
  const expected = stripForMatch(headerText);
  let consumed = '';
  let headerCount = 0;
  for (const run of runs) {
    const next = consumed + stripForMatch(run.str);
    if (!expected.startsWith(next)) break;
    consumed = next;
    headerCount++;
  }
  const header = runs.slice(0, headerCount);
  const rest = runs.slice(headerCount);
  const footer = rest.filter((run) => /^Page \d+ of \d+$/.test(run.str));
  return { header, footer, body: rest.filter((run) => !footer.includes(run)) };
}

/** Text boxes must not intersect — the 2-D generalisation of `expectNoHorizontalOverlap` (catches stacked sections). */
export function expectNoTextBoxOverlap(inspected: InspectedPdf): void {
  inspected.runsByPage.forEach((runs, pageIndex) => {
    for (let a = 0; a < runs.length; a++) {
      for (let b = a + 1; b < runs.length; b++) {
        const first = runs[a]!;
        const second = runs[b]!;
        const xOverlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
        const dy = Math.abs(first.y - second.y);
        const minHeight = Math.min(first.height, second.height);
        // Consecutive wrapped lines are >= ~1.1 x font size apart; < 0.6 x means the glyph boxes collide.
        expect(
          xOverlap <= 0.7 || dy >= minHeight * 0.6,
          `page ${pageIndex + 1}: "${first.str}" overlaps "${second.str}"`,
        ).toBe(true);
      }
    }
  });
}

/**
 * Body text must sit between the header band and the footer band; the header must stay inside its band and
 * the footer must read "Page N of <total>" with N matching the page.
 */
export function expectBodyWithinPageBands(inspected: InspectedPdf, headerText: string): void {
  inspected.runsByPage.forEach((runs, index) => {
    const pageHeight = inspected.pageSizes[index]!.height;
    const { header, footer, body } = splitPageChrome(runs, headerText);
    expect(header.length, `page ${index + 1}: header missing`).toBeGreaterThan(0);
    expect(footer.map((run) => run.str), `page ${index + 1}: footer`).toEqual([
      `Page ${index + 1} of ${inspected.numPages}`,
    ]);
    for (const run of header) {
      expect(run.y, `page ${index + 1}: header "${run.str}" grew below its band`).toBeGreaterThanOrEqual(
        pageHeight - PDF_PORTRAIT_TOP_PADDING,
      );
    }
    for (const run of body) {
      expect(run.y + run.height, `page ${index + 1}: "${run.str}" prints into the header band`).toBeLessThanOrEqual(
        pageHeight - PDF_PORTRAIT_TOP_PADDING + 2,
      );
      expect(run.y, `page ${index + 1}: "${run.str}" prints into the footer band`).toBeGreaterThanOrEqual(
        PDF_PORTRAIT_BOTTOM_PADDING - 2,
      );
    }
  });
}

/**
 * The lowest body line of every page except the last must not be one of `leadIns` (section headings, field
 * labels, table column headers): such a line is stranded from the content it introduces, which starts on
 * the next page.
 */
export function expectNoStrandedLeadIns(inspected: InspectedPdf, headerText: string, leadIns: string[]): void {
  const leadInSet = new Set(leadIns);
  for (let index = 0; index < inspected.numPages - 1; index++) {
    const { body } = splitPageChrome(inspected.runsByPage[index]!, headerText);
    if (body.length === 0) continue;
    const lowestY = Math.min(...body.map((run) => run.y));
    const lowestLine = body.filter((run) => Math.abs(run.y - lowestY) < 1.5).map((run) => run.str.trim());
    expect(
      lowestLine.every((text) => leadInSet.has(text)),
      `page ${index + 1} ends with stranded lead-in(s): ${lowestLine.join(' | ')}`,
    ).toBe(false);
  }
}
