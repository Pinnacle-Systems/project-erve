import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ErveDispatchListDocument } from './ErveDispatchListDocument.js';
import type { ErveDispatchListPdfRow, ErveDispatchListPdfViewModel } from './buildErveDispatchListViewModel.js';

function makeRow(overrides: Partial<ErveDispatchListPdfRow> = {}): ErveDispatchListPdfRow {
  return {
    id: 'ed-1',
    erveDispatchNumber: 'ED/26-27/0001',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributorName: 'Acme Distributors',
    saleOrderNumber: 'EISO/26-27/0001',
    dispatchDate: '30 Jun 2026',
    statusLabel: 'Dispatched',
    deliveredAt: '',
    transporter: 'Blue Dart',
    lrNumber: 'LR-001',
    totalQuantity: 20,
    ...overrides,
  };
}

function makeViewModel(rows: ErveDispatchListPdfRow[]): ErveDispatchListPdfViewModel {
  return {
    title: 'ERVE DISPATCH LIST',
    subtitle: 'Physical goods movement from Erve India to Distributors',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('ErveDispatchListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<ErveDispatchListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<ErveDispatchListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a delivered row without throwing', async () => {
    const rows = [makeRow({ statusLabel: 'Delivered', deliveredAt: '05 Jul 2026' })];
    const blob = await pdf(<ErveDispatchListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => makeRow({ id: `ed-${i}`, erveDispatchNumber: `ED/26-27/${String(i).padStart(4, '0')}` }));
    const blob = await Promise.race([
      pdf(<ErveDispatchListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Erve Dispatch list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
