import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryInvoiceDetailDocument } from './FactoryInvoiceDetailDocument.js';
import type { FactoryInvoiceDetailLineRow, FactoryInvoiceDetailPdfViewModel } from './buildFactoryInvoiceDetailViewModel.js';

function makeLine(overrides: Partial<FactoryInvoiceDetailLineRow> = {}): FactoryInvoiceDetailLineRow {
  return {
    id: 'l1',
    styleDisplay: 'ST-1 — Shirt',
    sizeLabel: 'Medium',
    quantity: 108,
    defaultRate: 'INR 105.00',
    unitRate: 'INR 95.00',
    rateOverridden: true,
    lineAmount: 'INR 10260.00',
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<FactoryInvoiceDetailPdfViewModel> = {}): FactoryInvoiceDetailPdfViewModel {
  return {
    title: 'FACTORY INVOICE',
    subtitle: 'FD/26-27/0001 — Acme Factory',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [{ label: 'Factory', value: 'Acme Factory' }],
    lines: [makeLine()],
    subtotal: 'INR 1000.00',
    gstAmount: 'INR 50.00',
    total: 'INR 1050.00',
    remarks: null,
    ...overrides,
  };
}

describe('FactoryInvoiceDetailDocument', () => {
  it('renders a single-line invoice without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders with remarks without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel({ remarks: 'Please expedite' })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero-GST, zero-total invoice without throwing', async () => {
    const blob = await pdf(
      <FactoryInvoiceDetailDocument viewModel={makeViewModel({ gstAmount: 'INR 0.00', total: 'INR 0.00', subtotal: 'INR 0.00' })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many invoice lines spanning multiple PDF pages without throwing', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => makeLine({ id: `l${i}`, styleDisplay: `ST-${i} — Style ${i}` }));
    const blob = await Promise.race([
      pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel({ lines })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Factory Invoice detail')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
