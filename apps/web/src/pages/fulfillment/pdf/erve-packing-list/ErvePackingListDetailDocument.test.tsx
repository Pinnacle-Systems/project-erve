import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import type { ErvePackingListDetailCartonRow, ErvePackingListDetailPdfViewModel } from './buildErvePackingListDetailViewModel.js';

function makeCarton(overrides: Partial<ErvePackingListDetailCartonRow> = {}): ErvePackingListDetailCartonRow {
  return {
    id: 'carton-1',
    cartonNumber: 'CTN-001',
    factoryName: 'Acme Factory',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryDispatchNumber: 'FD/26-27/0001',
    packageDetails: 'Standard box',
    weight: '5kg',
    totalQuantity: 20,
    lines: [{ saleOrderLineId: 'sol-1', styleDisplay: 'ST-1 — Shirt', sizeLabel: 'Medium', quantity: 20 }],
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
    styleSizeSummary: [{ key: 'ST-1-M', styleDisplay: 'ST-1 — Shirt', sizeLabel: 'Medium', quantity: 20 }],
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
      <ErvePackingListDetailDocument viewModel={makeViewModel({ cartons: [], totalCartonCount: 0, totalQuantity: 0, styleSizeSummary: [] })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a dispatched packing list with its Erve Dispatch reference without throwing', async () => {
    const blob = await pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ dispatchReference: 'ED/26-27/0001' })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders cartons spanning multiple Factories/Dispatch Orders without throwing', async () => {
    const cartons = [
      makeCarton({ id: 'carton-1', factoryName: 'Factory One', saleOrderNumber: 'EISO/26-27/0001' }),
      makeCarton({ id: 'carton-2', factoryName: 'Factory Two', saleOrderNumber: 'EISO/26-27/0002' }),
    ];
    const blob = await pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ cartons, totalCartonCount: 2, totalQuantity: 40 })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many cartons spanning multiple PDF pages without throwing', async () => {
    const cartons = Array.from({ length: 80 }, (_, i) => makeCarton({ id: `carton-${i}`, cartonNumber: `CTN-${String(i).padStart(3, '0')}` }));
    const blob = await Promise.race([
      pdf(<ErvePackingListDetailDocument viewModel={makeViewModel({ cartons, totalCartonCount: 80, totalQuantity: 1600 })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Erve Packing List detail')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
