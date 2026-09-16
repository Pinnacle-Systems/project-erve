import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ErvePackingListListDocument } from './ErvePackingListListDocument.js';
import type { ErvePackingListListPdfRow, ErvePackingListListPdfViewModel } from './buildErvePackingListListViewModel.js';

function makeRow(overrides: Partial<ErvePackingListListPdfRow> = {}): ErvePackingListListPdfRow {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributorName: 'Acme Distributors',
    destinationDisplay: 'Mumbai, Maharashtra',
    cartonCount: 2,
    totalQuantity: 50,
    sourceFactoryCount: 1,
    sourceDispatchOrderCount: 1,
    statusLabel: 'Open',
    createdAt: '30 Jun 2026',
    ...overrides,
  };
}

function makeViewModel(rows: ErvePackingListListPdfRow[]): ErvePackingListListPdfViewModel {
  return {
    title: 'ERVE PACKING LIST',
    subtitle: 'Destination-specific consolidation of finalized Factory Packing cartons',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('ErvePackingListListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<ErvePackingListListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<ErvePackingListListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a row consolidated across multiple Factories/Dispatch Orders without throwing', async () => {
    const rows = [makeRow({ sourceFactoryCount: 3, sourceDispatchOrderCount: 4 })];
    const blob = await pdf(<ErvePackingListListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      makeRow({ id: `epl-${i}`, ervePackingListNumber: `EIPL/26-27/${String(i).padStart(4, '0')}` }),
    );
    const blob = await Promise.race([
      pdf(<ErvePackingListListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Erve Packing List list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
