import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { StyleListDocument } from './StyleListDocument.js';
import type { StyleListPdfRow, StyleListPdfViewModel } from './buildStyleListViewModel.js';
import { createSolidColorPngDataUri } from '../../../test-support/solid-color-png.js';

function makeRow(overrides: Partial<StyleListPdfRow> = {}): StyleListPdfRow {
  return {
    id: 'style-1',
    image: { placeholder: true },
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    seasonLabel: 'SS27',
    hsnCode: '6109',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: StyleListPdfRow[]): StyleListPdfViewModel {
  return {
    title: 'STYLE MASTER LIST',
    subtitle: 'Item master records',
    filters: [{ label: 'Search', value: '' }],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('StyleListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeRow({ id: `style-${i}`, styleNumber: `STY-${String(i).padStart(4, '0')}` }),
    );
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a mix of resolved images and placeholders without throwing', async () => {
    const rows = [
      makeRow({ id: 'a', image: { dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }),
      makeRow({ id: 'b', image: { placeholder: true } }),
    ];
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});

// PDF-AR-001: distinct Styles must show distinct, correctly-proportioned thumbnails in the same
// table — not just "an image renders somewhere" (covered above) but each row's own aspect ratio,
// in row order, with a missing image contributing no image paint at all.
describe('PDF-AR-001 Style Master List thumbnails', () => {
  it('preserves each row\'s own aspect ratio within the 28x28 thumbnail cell, including a missing image', async () => {
    const rows = [
      makeRow({ id: 'portrait', styleNumber: 'STY-0001', image: { dataUri: createSolidColorPngDataUri(100, 160) } }),
      makeRow({ id: 'landscape', styleNumber: 'STY-0002', image: { dataUri: createSolidColorPngDataUri(200, 90) } }),
      makeRow({ id: 'square', styleNumber: 'STY-0003', image: { dataUri: createSolidColorPngDataUri(150, 150) } }),
      makeRow({ id: 'missing', styleNumber: 'STY-0004', image: { placeholder: true } }),
    ];
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel(rows)} />).toBlob();
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
    try {
      const document = await task.promise;
      expect(document.numPages).toBe(1);
      const page = await document.getPage(1);
      const ops = await page.getOperatorList();
      // The shared PdfHeader also paints the ERVE logo (ISS-018) — excluded here by its own
      // known natural pixel dimensions, since this test is only about the three Style thumbnails.
      const paintIndices = ops.fnArray.flatMap((fn, i) => {
        if (fn !== OPS.paintImageXObject) return [];
        const [, naturalWidth, naturalHeight] = ops.argsArray[i] as [string, number, number];
        return naturalWidth === 1117 && naturalHeight === 153 ? [] : [i];
      });
      // Only the three resolved rows paint an image; the missing row paints none.
      expect(paintIndices).toHaveLength(3);

      const rendered = paintIndices.map((paintIndex) => {
        let transformIndex = -1;
        for (let i = paintIndex - 1; i >= 0; i -= 1) {
          if (ops.fnArray[i] === OPS.transform) {
            transformIndex = i;
            break;
          }
        }
        const matrix = ops.argsArray[transformIndex] as number[];
        return { width: Math.abs(matrix[0]!), height: Math.abs(matrix[3]!) };
      });

      const box = 28;
      const [portrait, landscape, square] = rendered;
      // Portrait (100/160): height-bound.
      expect(portrait!.height).toBeCloseTo(box, 0);
      expect(portrait!.width).toBeCloseTo(box * (100 / 160), 0);
      // Landscape (200/90): width-bound.
      expect(landscape!.width).toBeCloseTo(box, 0);
      expect(landscape!.height).toBeCloseTo(box * (90 / 200), 0);
      // Square: fills the cell exactly.
      expect(square!.width).toBeCloseTo(box, 0);
      expect(square!.height).toBeCloseTo(box, 0);
      // None overflow the cell, regardless of source ratio.
      for (const image of rendered) {
        expect(image.width).toBeLessThanOrEqual(box + 0.5);
        expect(image.height).toBeLessThanOrEqual(box + 0.5);
      }
    } finally {
      await task.destroy();
    }
  });
});
