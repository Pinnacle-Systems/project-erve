import { pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { cartonHeading, ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import type { ErvePackingListDetailCartonRow, ErvePackingListDetailPdfViewModel } from './buildErvePackingListDetailViewModel.js';
import { createSolidColorPngDataUri } from '../../../../test-support/solid-color-png.js';

function makeCarton(overrides: Partial<ErvePackingListDetailCartonRow> = {}): ErvePackingListDetailCartonRow {
  return {
    id: 'carton-1',
    cartonNumber: 'CTN-001',
    packageDetails: 'Standard box',
    weight: '5kg',
    totalQuantity: 20,
    lines: [{ saleOrderLineId: 'sol-1', styleDisplay: 'ST-1 — Shirt', sizeLabel: 'Medium', quantity: 20 }],
    sizeColumns: [{ sizeId: 'M', sizeCode: 'M' }],
    styleRows: [{ styleId: 'ST-1', styleNumber: 'ST-1', styleName: 'Shirt', values: { M: 20 } }],
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<ErvePackingListDetailPdfViewModel> = {}): ErvePackingListDetailPdfViewModel {
  return {
    title: 'ERVE PACKING LIST',
    subtitle: 'EIPL/26-27/0001 — Acme Distributors',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [{ label: 'EIPL Number', value: 'EIPL/26-27/0001' }],
    destinationItems: [{ label: 'Destination', value: 'Mumbai Warehouse' }],
    cartons: [makeCarton()],
    totalCartonCount: 1,
    totalQuantity: 20,
    styleSizeSizeColumns: [{ sizeId: 'M', sizeCode: 'M' }],
    styleSizeSummaryRows: [{ styleId: 'ST-1', styleNumber: 'ST-1', styleName: 'Shirt', values: { M: 20 } }],
    dispatchReference: null,
    ...overrides,
  };
}

describe('ErvePackingListDetailDocument', () => {
  it('renders a single-carton document without throwing', async () => {
    const blob = await pdf(<ErvePackingListDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders with no cartons yet (OPEN, freshly created) without throwing', async () => {
    const blob = await pdf(
      <ErvePackingListDetailDocument viewModel={makeViewModel({ cartons: [], totalCartonCount: 0, totalQuantity: 0, styleSizeSizeColumns: [], styleSizeSummaryRows: [] })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a dispatched packing list with its Erve Dispatch reference without throwing', async () => {
    const blob = await pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ dispatchReference: 'ED/26-27/0001' })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders cartons spanning multiple Factories/Dispatch Orders without throwing', async () => {
    const cartons = [
      makeCarton({ id: 'carton-1', cartonNumber: 'CTN-001' }),
      makeCarton({ id: 'carton-2', cartonNumber: 'CTN-002' }),
    ];
    const blob = await pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ cartons, totalCartonCount: 2, totalQuantity: 40 })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many cartons spanning multiple PDF pages without throwing', async () => {
    const cartons = Array.from({ length: 80 }, (_, i) => makeCarton({ id: `carton-${i}`, cartonNumber: `CTN-${String(i).padStart(3, '0')}` }));
    // This is a real hang detector, not a performance benchmark — the full suite's parallel test
    // load can make a tight budget flaky even though a genuine hang would still be caught well
    // under 20s (see FactoryPackingListDetailDocument.test.tsx's identical note).
    const blob = await Promise.race([
      pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ cartons, totalCartonCount: 80, totalQuantity: 1600 })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Erve Packing List detail')), 20000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 22000);

  // ISS-023 Phase 3: Style x Size matrix presentation and its pagination.
  describe('Style x Size matrix presentation and pagination', () => {
    it('renders a carton with multiple Styles and a wide Size range without throwing', async () => {
      const sizeColumns = Array.from({ length: 10 }, (_, i) => ({ sizeId: `SZ${i}`, sizeCode: `SZ${i}` }));
      const styleRows = Array.from({ length: 3 }, (_, si) => ({
        styleId: `ST-00${si}`,
        styleNumber: `ST-00${si}`,
        styleName: `Style ${si}`,
        values: Object.fromEntries(sizeColumns.map((c, i) => [c.sizeId, i % 2 === 0 ? si + i : null])),
      }));
      const blob = await pdf(
        <ErvePackingListDetailDocument
          viewModel={makeViewModel({ cartons: [makeCarton({ sizeColumns, styleRows, totalQuantity: 999 })] })}
        />,
      ).toBlob();
      expect(blob.size).toBeGreaterThan(0);
    });

    it('renders a Style/Size Summary with many Styles spanning multiple pages without throwing or truncating', async () => {
      const styleSizeSizeColumns = [{ sizeId: 'M', sizeCode: 'M' }, { sizeId: 'L', sizeCode: 'L' }];
      const styleSizeSummaryRows = Array.from({ length: 60 }, (_, i) => ({
        styleId: `ST-${String(i).padStart(3, '0')}`,
        styleNumber: `ST-${String(i).padStart(3, '0')}`,
        styleName: `Style ${i}`,
        values: { M: 5, L: 5 },
      }));
      const blob = await Promise.race([
        pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ styleSizeSizeColumns, styleSizeSummaryRows })} />).toBlob(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('PDF generation hung on a long Style/Size Summary')), 20000),
        ),
      ]);
      expect(blob.size).toBeGreaterThan(0);
    }, 22000);
  });

  // ISS-054: the carton heading never prints internal factory provenance,
  // the EISO Dispatch Order number, or the EIFD Factory Dispatch number —
  // only the carton number (and weight, when present) on this external PDF.
  describe('cartonHeading — internal provenance / EISO / EIFD redaction (ISS-054)', () => {
    it('prints only the carton number and weight', () => {
      expect(cartonHeading(makeCarton())).toBe('Carton CTN-001 — 5kg');
    });

    it('omits the weight segment — and its separator — when absent', () => {
      const heading = cartonHeading(makeCarton({ weight: null }));
      expect(heading).toBe('Carton CTN-001');
      expect(heading).not.toContain('null');
      expect(heading).not.toContain('undefined');
    });

    it('never prints an EISO or EIFD-shaped reference, regardless of input', () => {
      const heading = cartonHeading(makeCarton());
      expect(heading).not.toMatch(/EISO|EIFD/);
    });
  });

  // ISS-053: buildErvePackingListDetailViewModel already resolves `row.image`, and
  // PdfStyleSizeMatrix already renders it via PdfThumbnail — this proves the full chain renders a
  // real, aspect-ratio-correct thumbnail per distinct Style, both in a carton and in the Style/Size
  // Summary, and that a missing image paints no image at all rather than a broken reference.
  describe('ISS-053 Style thumbnails', () => {
    it('renders each Style\'s own distinct, aspect-ratio-correct thumbnail in a carton and the summary, with no image at all for a Style with none uploaded', async () => {
      const portrait = { dataUri: createSolidColorPngDataUri(100, 160) };
      const landscape = { dataUri: createSolidColorPngDataUri(200, 90) };
      const sizeColumns = [{ sizeId: 'M', sizeCode: 'M' }];
      const styleRows = [
        { styleId: 'ST-1', styleNumber: 'ST-1', styleName: 'Shirt', values: { M: 10 }, image: portrait },
        { styleId: 'ST-2', styleNumber: 'ST-2', styleName: 'Pants', values: { M: 10 }, image: landscape },
        { styleId: 'ST-3', styleNumber: 'ST-3', styleName: 'Socks', values: { M: 10 }, image: { placeholder: true as const } },
      ];
      const viewModel = makeViewModel({
        cartons: [makeCarton({ sizeColumns, styleRows, totalQuantity: 30 })],
        styleSizeSizeColumns: sizeColumns,
        styleSizeSummaryRows: styleRows,
      });
      const blob = await pdf(<ErvePackingListDetailDocument viewModel={viewModel} />).toBlob();
      const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
      try {
        const document = await task.promise;
        const page = await document.getPage(1);
        const ops = await page.getOperatorList();
        // The shared PdfHeader also paints the ERVE logo (ISS-018) — excluded by its own known
        // natural pixel dimensions, since this test is only about the Style thumbnails.
        const paintIndices = ops.fnArray.flatMap((fn, i) => {
          if (fn !== OPS.paintImageXObject) return [];
          const [, naturalWidth, naturalHeight] = ops.argsArray[i] as [string, number, number];
          return naturalWidth === 1117 && naturalHeight === 153 ? [] : [i];
        });
        // 2 Styles with real images x 2 tables (carton + summary) = 4. ST-3's placeholder paints
        // nothing, in either table.
        expect(paintIndices).toHaveLength(4);

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

        const box = 20; // PdfStyleSizeMatrix's own fixed thumbnail box (styles.ts: width/height 20).
        for (const [index, image] of rendered.entries()) {
          // Carton table first, then the Style/Size Summary — portrait (ST-1), then landscape (ST-2).
          const isPortrait = index % 2 === 0;
          if (isPortrait) {
            expect(image.height).toBeCloseTo(box, 0);
            expect(image.width).toBeCloseTo(box * (100 / 160), 0);
          } else {
            expect(image.width).toBeCloseTo(box, 0);
            expect(image.height).toBeCloseTo(box * (90 / 200), 0);
          }
          expect(image.width).toBeLessThanOrEqual(box + 0.5);
          expect(image.height).toBeLessThanOrEqual(box + 0.5);
        }
      } finally {
        await task.destroy();
      }
    });
  });
});
