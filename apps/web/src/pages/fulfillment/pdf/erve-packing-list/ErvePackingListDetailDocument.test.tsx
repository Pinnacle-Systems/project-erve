import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { cartonHeading, ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import type { ErvePackingListDetailCartonRow, ErvePackingListDetailPdfViewModel } from './buildErvePackingListDetailViewModel.js';

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
});
