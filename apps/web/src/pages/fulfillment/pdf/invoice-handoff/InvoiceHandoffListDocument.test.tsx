import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { InvoiceHandoffListDocument } from './InvoiceHandoffListDocument.js';
import type { InvoiceHandoffListPdfRow, InvoiceHandoffListPdfViewModel } from './buildInvoiceHandoffListViewModel.js';

function makeRow(overrides: Partial<InvoiceHandoffListPdfRow> = {}): InvoiceHandoffListPdfRow {
  return {
    id: 'ih-1',
    modeLabel: 'Outright',
    erveDispatchNumber: 'ED/26-27/0001',
    distributorName: 'Acme Distributors',
    styleDisplay: 'ST-1 / Medium',
    quantity: 20,
    statusLabel: 'Pending Tally',
    tallyInvoiceNumber: null,
    tallyInvoiceDate: '',
    ...overrides,
  };
}

function makeViewModel(rows: InvoiceHandoffListPdfRow[], filters: InvoiceHandoffListPdfViewModel['filters'] = []): InvoiceHandoffListPdfViewModel {
  return {
    title: 'INVOICE HANDOFF LIST',
    subtitle: 'Physically dispatched quantities awaiting a Tally invoice reference',
    filters,
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('InvoiceHandoffListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<InvoiceHandoffListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<InvoiceHandoffListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders an invoiced row with a Tally reference without throwing', async () => {
    const rows = [makeRow({ statusLabel: 'Invoiced', tallyInvoiceNumber: 'TALLY-001', tallyInvoiceDate: '05 Jul 2026' })];
    const blob = await pdf(<InvoiceHandoffListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => makeRow({ id: `ih-${i}` }));
    const blob = await Promise.race([
      pdf(<InvoiceHandoffListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Invoice Handoff list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
