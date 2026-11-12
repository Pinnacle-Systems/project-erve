import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

/** One rendered text run (react-pdf emits one run per wrapped line of a `<Text>`). */
export interface PdfTextRun {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface InspectedPdf {
  numPages: number;
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
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      pageSizes.push({ width: page.view[2]!, height: page.view[3]! });
      const content = await page.getTextContent();
      runsByPage.push(
        content.items.flatMap((item) =>
          'str' in item && item.str.trim()
            ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width }]
            : [],
        ),
      );
    }
    const fullText = runsByPage
      .map((runs) => runs.map((run) => run.str).join(' '))
      .join('\n')
      .replace(/\s+/g, ' ');
    return { numPages: doc.numPages, pageSizes, runsByPage, fullText };
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
