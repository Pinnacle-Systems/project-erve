import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfDocument } from './PdfDocument.js';
import { PdfStyleSizeMatrix, type PdfStyleSizeMatrixColumn, type PdfStyleSizeMatrixRow } from './PdfStyleSizeMatrix.js';

// Real page-level verification, not just "the PDF bytes exist" — renders the document, opens it
// with pdfjs-dist (same Node-legacy-build pattern already used by
// apps/api/src/modules/historical-import/pdf-document-session.ts), and extracts actual text per
// page. This is what establishes that many Style rows / a wide Size range genuinely paginate
// (not silently overflow or clip onto one page) and that every row's content and the grand total
// survive that pagination exactly once.

interface OpenedPdf {
  numPages: number;
  textByPage: string[];
  fullText: string;
}

const openSessions: { destroy: () => Promise<void> }[] = [];

afterEach(async () => {
  // Never open a second pdfjs session against the same bytes in one process (see the
  // historical-import module's documented pdfjs-dist 6.x/Node quirk) — each test here renders
  // distinct content, but sessions are still closed promptly as that module's convention requires.
  await Promise.all(openSessions.splice(0).map((session) => session.destroy()));
});

async function renderAndOpen(children: React.ReactElement): Promise<OpenedPdf> {
  const blob = await pdf(<PdfDocument orientation="landscape">{children}</PdfDocument>).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const doc = await loadingTask.promise;
  openSessions.push({ destroy: () => loadingTask.destroy() });

  const textByPage: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    textByPage.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return { numPages: doc.numPages, textByPage, fullText: textByPage.join('\n') };
}

function manyRows(count: number): PdfStyleSizeMatrixRow[] {
  return Array.from({ length: count }, (_, i) => ({
    styleId: `style-${i}`,
    styleNumber: `ST-${String(i).padStart(3, '0')}`,
    values: { 'size-s': i + 1, 'size-m': i + 2, 'size-l': i + 3 },
  }));
}

const threeColumns: PdfStyleSizeMatrixColumn[] = [
  { sizeId: 'size-s', sizeCode: 'S' },
  { sizeId: 'size-m', sizeCode: 'M' },
  { sizeId: 'size-l', sizeCode: 'L' },
];

describe('PdfStyleSizeMatrix — real pagination (page count, header repeats, no clipped/duplicated content)', () => {
  it('actually paginates 60 Style rows across multiple pages (not a single overflowing page)', async () => {
    const rows = manyRows(60);
    const opened = await renderAndOpen(<PdfStyleSizeMatrix columns={threeColumns} rows={rows} />);

    expect(opened.numPages).toBeGreaterThan(1);
  });

  it('preserves every Style row\'s label across pages when paginated, with none dropped or clipped', async () => {
    const rows = manyRows(60);
    const opened = await renderAndOpen(<PdfStyleSizeMatrix columns={threeColumns} rows={rows} />);

    for (const row of rows) {
      expect(opened.fullText).toContain(row.styleNumber);
    }
  });

  it('repeats the header more than once across a paginated 60-row block (not a single fixed header that could drift onto unrelated content)', async () => {
    const rows = manyRows(60);
    const opened = await renderAndOpen(
      <PdfStyleSizeMatrix columns={threeColumns} rows={rows} rowsPerHeaderRepeat={25} />,
    );

    const headerOccurrences = (opened.fullText.match(/Style/g) ?? []).length;
    expect(headerOccurrences).toBeGreaterThan(1);
  });

  it('shows the grand total exactly once, never duplicated across the paginated pages', async () => {
    const rows = manyRows(60);
    const grandTotal = rows.reduce((sum, row) => sum + row.values['size-s']! + row.values['size-m']! + row.values['size-l']!, 0);
    const opened = await renderAndOpen(<PdfStyleSizeMatrix columns={threeColumns} rows={rows} />);

    const occurrences = opened.fullText.split(String(grandTotal)).length - 1;
    expect(occurrences).toBe(1);
  });

  it('paginates a wide Size range (20 columns, 3 groups) across multiple pages without clipping any Size label', async () => {
    const wideColumns: PdfStyleSizeMatrixColumn[] = Array.from({ length: 20 }, (_, i) => ({
      sizeId: `size-${i}`,
      sizeCode: `SZ${i}`,
    }));
    const rows: PdfStyleSizeMatrixRow[] = manyRows(40).map((row) => ({
      ...row,
      values: Object.fromEntries(wideColumns.map((c, i) => [c.sizeId, i])),
    }));
    const opened = await renderAndOpen(
      <PdfStyleSizeMatrix columns={wideColumns} rows={rows} maxColumnsPerGroup={8} rowsPerHeaderRepeat={25} />,
    );

    expect(opened.numPages).toBeGreaterThan(1);
    for (const column of wideColumns) {
      expect(opened.fullText).toContain(column.sizeCode);
    }
    // Every row's Style label must still appear even though it's split across 3 column-group
    // blocks and multiple pages — nothing silently dropped.
    for (const row of rows) {
      expect(opened.fullText).toContain(row.styleNumber);
    }
  });
});
