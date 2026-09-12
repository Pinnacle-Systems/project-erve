import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { OrderSheetListDocument } from './OrderSheetListDocument.js';
import type { OrderSheetListPdfRow, OrderSheetListPdfViewModel } from './buildOrderSheetListViewModel.js';

function makeRow(overrides: Partial<OrderSheetListPdfRow> = {}): OrderSheetListPdfRow {
  return {
    id: 'po-1',
    poNumber: 'EIOS/26-27/0001',
    distributorName: 'Acme Distributors',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    purchaseMode: 'Outright',
    poDate: '01 Apr 2026',
    requiredDeliveryDate: '01 May 2026',
    totalOrderedQuantity: 500,
    planningState: 'Available for Job Order',
    jobOrderNumber: '',
    ...overrides,
  };
}

function makeViewModel(rows: OrderSheetListPdfRow[]): OrderSheetListPdfViewModel {
  return {
    title: 'ORDER SHEET LIST',
    subtitle: 'Distributor demand forecast',
    filters: [],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('OrderSheetListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<OrderSheetListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<OrderSheetListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a row with no linked Job Order and no delivery date as an em dash without throwing', async () => {
    const rows = [makeRow({ requiredDeliveryDate: '', jobOrderNumber: '' })];
    const blob = await pdf(<OrderSheetListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders an active filter summary without throwing', async () => {
    const vm = { ...makeViewModel([makeRow()]), filters: [{ label: 'Search', value: 'EIOS' }] };
    const blob = await pdf(<OrderSheetListDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      makeRow({ id: `po-${i}`, poNumber: `EIOS/26-27/${String(i).padStart(4, '0')}` }),
    );
    const blob = await Promise.race([
      pdf(<OrderSheetListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Order Sheet list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
