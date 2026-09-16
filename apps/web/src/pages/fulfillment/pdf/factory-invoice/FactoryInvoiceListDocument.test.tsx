import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryInvoiceListDocument } from './FactoryInvoiceListDocument.js';
import type { FactoryInvoiceListPdfRow, FactoryInvoiceListPdfViewModel } from './buildFactoryInvoiceListViewModel.js';

function makeRow(overrides: Partial<FactoryInvoiceListPdfRow> = {}): FactoryInvoiceListPdfRow {
  return {
    id: 'fi-1',
    factoryName: 'Acme Factory',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryDispatchNumber: 'FD/26-27/0001',
    lineCount: 3,
    subtotal: 'INR 1000.00',
    gstAmount: 'INR 50.00',
    total: 'INR 1050.00',
    statusLabel: 'Awaiting Factory Confirmation',
    ...overrides,
  };
}

function makeViewModel(rows: FactoryInvoiceListPdfRow[], filters: FactoryInvoiceListPdfViewModel['filters'] = []): FactoryInvoiceListPdfViewModel {
  return {
    title: 'FACTORY INVOICE LIST',
    subtitle: 'ERVE-generated payable documents snapshotted from finalized Factory Packing Lists',
    filters,
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('FactoryInvoiceListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with an active Status filter without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceListDocument viewModel={makeViewModel([makeRow()], [{ label: 'Status', value: 'Finalized' }])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => makeRow({ id: `fi-${i}` }));
    const blob = await Promise.race([
      pdf(<FactoryInvoiceListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Factory Invoice list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
