import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DispatchOrderListDocument } from './DispatchOrderListDocument.js';
import type { DispatchOrderListPdfRow, DispatchOrderListPdfViewModel } from './buildDispatchOrderListViewModel.js';

function makeRow(overrides: Partial<DispatchOrderListPdfRow> = {}): DispatchOrderListPdfRow {
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributorsDisplay: 'Acme Distributors',
    factoryName: 'Acme Factory',
    soDate: '30 Jun 2026',
    financialYearCode: '26-27',
    destinationCount: 1,
    totalQuantity: 100,
    stateLabel: 'Ready for Factory',
    ...overrides,
  };
}

function makeViewModel(rows: DispatchOrderListPdfRow[]): DispatchOrderListPdfViewModel {
  return {
    title: 'DISPATCH ORDER LIST',
    subtitle: 'Pooled Factory stock allocated to Distributor destinations',
    filters: [],
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('DispatchOrderListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<DispatchOrderListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<DispatchOrderListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a row with a mixed-Purchase-Mode Distributor display without throwing', async () => {
    const rows = [makeRow({ distributorsDisplay: 'Acme (Outright), Beta (Sale/Return)' })];
    const blob = await pdf(<DispatchOrderListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      makeRow({ id: `so-${i}`, saleOrderNumber: `EISO/26-27/${String(i).padStart(4, '0')}` }),
    );
    const blob = await Promise.race([
      pdf(<DispatchOrderListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Dispatch Order list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
