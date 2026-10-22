import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PackingAuditListDocument } from './PackingAuditListDocument.js';
import type { PackingAuditListPdfRow, PackingAuditListPdfViewModel } from './buildPackingAuditListViewModel.js';

function makeRow(overrides: Partial<PackingAuditListPdfRow> = {}): PackingAuditListPdfRow {
  return {
    id: 'carton-1',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    distributorName: 'Distributor One',
    destinationLabel: 'Store 1 · Chennai, TN',
    cartonNumber: 'C1',
    totalQuantity: 10,
    auditStateLabel: 'Not Inspected',
    ...overrides,
  };
}

function makeViewModel(rows: PackingAuditListPdfRow[]): PackingAuditListPdfViewModel {
  return {
    title: 'PACKING AUDIT QUEUE',
    subtitle: 'Open cartons awaiting or already inspected on active Factory Dispatches',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test QA User',
    totalCount: rows.length,
    rows,
  };
}

// BUG-006 — real page-level verification (pdfjs-dist, same Node-legacy-build pattern as
// PdfStyleSizeMatrix.pagination.test.tsx and verifyErvePackingListPdf.test-utils.ts), not just
// "the PDF bytes exist": the full long value must actually appear in the extracted text (never a
// silently clipped substring), must not horizontally overlap its neighboring Carton #/Total
// Qty/Audit State columns, and must stay within the page's printable boundary.
interface OpenedPdf {
  numPages: number;
  fullText: string;
  itemsByPage: { str: string; x: number; y: number; width: number }[][];
  pageWidth: number;
}

const openSessions: { destroy: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(openSessions.splice(0).map((session) => session.destroy()));
});

async function renderAndOpen(viewModel: PackingAuditListPdfViewModel): Promise<OpenedPdf> {
  const blob = await pdf(<PackingAuditListDocument viewModel={viewModel} />).toBlob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
  const doc = await loadingTask.promise;
  openSessions.push({ destroy: () => loadingTask.destroy() });

  const itemsByPage: OpenedPdf['itemsByPage'] = [];
  let pageWidth = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pageWidth = page.view[2]!;
    const content = await page.getTextContent();
    itemsByPage.push(
      content.items.flatMap((item) =>
        'str' in item && item.str.trim()
          ? [{ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width }]
          : [],
      ),
    );
  }
  const fullText = itemsByPage
    .map((page) => page.map((i) => i.str).join(' '))
    .join('\n')
    .replace(/\s+/g, ' ');
  return { numPages: doc.numPages, fullText, itemsByPage, pageWidth };
}

function assertNoHorizontalOverlap(itemsByPage: OpenedPdf['itemsByPage']): void {
  for (const items of itemsByPage) {
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const x = items[a]!;
        const y = items[b]!;
        if (Math.abs(x.y - y.y) < 1) {
          const overlap = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
          expect(overlap, `"${x.str}" / "${y.str}" overlap`).toBeLessThanOrEqual(0.7);
        }
      }
    }
  }
}

describe('PackingAuditListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<PackingAuditListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('BUG-006: prints a long Distributor name and a long Destination label in full — never silently clipped — with no overlap into neighboring columns and no overflow past the page margin', async () => {
    const distributorName = 'The Very Long Distributor Name With Several Words That Should Wrap';
    const destinationLabel = 'The Extended Retail Outlet Name With Locality · Chennai, Tamil Nadu';
    const row = makeRow({ distributorName, destinationLabel });
    const opened = await renderAndOpen(makeViewModel([row]));

    expect(opened.fullText).toContain(distributorName);
    expect(opened.fullText).toContain(destinationLabel);
    assertNoHorizontalOverlap(opened.itemsByPage);
    for (const item of opened.itemsByPage.flat()) {
      expect(item.x + item.width, `"${item.str}" overflows the right margin`).toBeLessThanOrEqual(opened.pageWidth);
    }
  });

  it('BUG-006: an extremely long Destination label (address-length) still prints in full across wrapped lines, without truncation or ellipsis', async () => {
    const destinationLabel =
      'The Extremely Long Flagship Retail Outlet And Distribution Centre Name, Anna Salai Extension Road, T. Nagar, Chennai, Tamil Nadu, India';
    const opened = await renderAndOpen(makeViewModel([makeRow({ destinationLabel })]));

    // react-pdf may hyphenate a long word across a wrapped line ("Dis-" / "tribution") — a
    // rendering artifact of justified word-wrap, not truncation. Undo only that specific
    // "-<whitespace>" join seam before comparing, same normalization
    // verifyErvePackingListPdf.test-utils.ts already applies to wrapped Style names.
    const dehyphenated = opened.fullText.replace(/-\s+/g, '');
    expect(dehyphenated).toContain(destinationLabel);
    expect(opened.fullText).not.toContain('…');
    expect(opened.fullText).not.toContain('...');
    assertNoHorizontalOverlap(opened.itemsByPage);
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<PackingAuditListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple pages without throwing', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => makeRow({ id: `carton-${i}`, cartonNumber: `C${i}` }));
    const blob = await Promise.race([
      pdf(<PackingAuditListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Packing Audit queue')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
