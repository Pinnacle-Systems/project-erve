// Position-aware PDF text extraction (H1 plan §8/Context). pdfjs-dist's
// getTextContent() returns each text run's own (x, y) transform — the PDF
// content stream's item order does NOT reliably follow visual reading order
// (confirmed against the real AW25/SS26 samples: a table's "4" size-column
// header/value are emitted far from their "3 5 6 7 8" siblings in stream
// order, but land exactly between them once sorted by x). Everything here
// reconstructs visual layout from coordinates, never from item order.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Structural shape of pdfjs-dist's TextItem — not re-exported from the legacy build's own .d.mts, so declared locally rather than reaching into its internal types/ tree. */
interface PdfJsTextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLine {
  y: number;
  /** Items in this line, sorted left to right. */
  items: TextItem[];
  /** Items' text joined with single spaces, whitespace-collapsed. */
  text: string;
}

export interface PageLayout {
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
}

/** Two items are "the same line" if their y differs by less than this (points). */
const LINE_Y_TOLERANCE = 2.5;

export function linesFromItems(items: TextItem[]): TextLine[] {
  const nonBlank = items.filter((item) => item.text.trim().length > 0);
  const sortedByY = [...nonBlank].sort((a, b) => b.y - a.y);
  const rows: TextItem[][] = [];
  for (const item of sortedByY) {
    const openRow = rows.at(-1);
    if (openRow && Math.abs(openRow[0]!.y - item.y) <= LINE_Y_TOLERANCE) {
      openRow.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map((row) => {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    return {
      y: sorted[0]!.y,
      items: sorted,
      text: sorted
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  });
}

function isTextRun(item: object): boolean {
  return 'transform' in item;
}

/** Loads a single-page-expected historical PO PDF and returns its first page's reconstructed layout. Throws on a genuinely unreadable/corrupt PDF — callers classify that as a parse failure, not a crash. */
export async function loadFirstPageLayout(pdfBytes: Uint8Array): Promise<PageLayout> {
  const loadingTask = getDocument({ data: pdfBytes, useSystemFonts: true });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = content.items.filter(isTextRun).map((item) => {
      const run = item as unknown as PdfJsTextRun;
      return {
        text: run.str,
        x: run.transform[4]!,
        y: run.transform[5]!,
        width: run.width,
        height: run.height,
      };
    });
    return {
      pageNumber: 1,
      width: viewport.width,
      height: viewport.height,
      lines: linesFromItems(items),
    };
  } finally {
    await loadingTask.destroy();
  }
}

/** Total page count — used to flag a document that isn't the expected single-page template. */
export async function loadPageCount(pdfBytes: Uint8Array): Promise<number> {
  const loadingTask = getDocument({ data: pdfBytes, useSystemFonts: true });
  try {
    const doc = await loadingTask.promise;
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}
