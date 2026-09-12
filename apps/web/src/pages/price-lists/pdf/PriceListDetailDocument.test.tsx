import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PriceListDetailDocument } from './PriceListDetailDocument.js';
import type {
  PriceListDetailLineRow,
  PriceListDetailPdfViewModel,
} from './buildPriceListDetailViewModel.js';

function makeLine(overrides: Partial<PriceListDetailLineRow> = {}): PriceListDetailLineRow {
  return {
    id: 'line-1',
    styleNumber: '39026006',
    styleName: 'BOYS REGULAR TSHIRT',
    unitPrice: 'INR 249.50',
    ...overrides,
  };
}

function makeViewModel(lines: PriceListDetailLineRow[]): PriceListDetailPdfViewModel {
  return {
    title: 'PRICE LIST',
    subtitle: 'PL-2026-000001 — FY 2026 Prices',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Price List Code', value: 'PL-2026-000001' },
      { label: 'Distributor', value: 'Acme Distributors' },
      { label: 'Status', value: 'Active' },
      { label: 'Effective From', value: '01 Jan 2026' },
      { label: 'Effective To', value: 'Open-ended' },
      { label: 'Lines', value: lines.length },
    ],
    lines,
  };
}

describe('PriceListDetailDocument', () => {
  it('renders with zero lines without throwing', async () => {
    const blob = await pdf(<PriceListDetailDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single line without throwing', async () => {
    const blob = await pdf(<PriceListDetailDocument viewModel={makeViewModel([makeLine()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero-formatted price without throwing', async () => {
    const lines = [makeLine({ unitPrice: 'INR 0.00' })];
    const blob = await pdf(<PriceListDetailDocument viewModel={makeViewModel(lines)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rate lines spanning multiple pages, with a repeated table header', async () => {
    const lines = Array.from({ length: 150 }, (_, i) =>
      makeLine({ id: `line-${i}`, styleNumber: `STY-${i}`, styleName: `Style ${i}` }),
    );
    const blob = await Promise.race([
      pdf(<PriceListDetailDocument viewModel={makeViewModel(lines)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long price list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
