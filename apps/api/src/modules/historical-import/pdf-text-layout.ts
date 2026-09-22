// Position-aware PDF text layout reconstruction (H1 plan §8/Context).
// pdfjs-dist's getTextContent() returns each text run's own (x, y)
// transform — the PDF content stream's item order does NOT reliably follow
// visual reading order (confirmed against the real AW25/SS26 samples: a
// table's "4" size-column header/value are emitted far from their
// "3 5 6 7 8" siblings in stream order, but land exactly between them once
// sorted by x). Everything here reconstructs visual layout from
// coordinates, never from item order.
//
// Pure logic only — no pdfjs I/O. Actually loading a PDF and extracting its
// text items happens in pdf-document-session.ts (a single shared pdfjs
// session per file; see that module's comment for why).

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

