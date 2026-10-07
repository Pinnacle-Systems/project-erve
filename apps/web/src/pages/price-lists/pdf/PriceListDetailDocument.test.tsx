import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PriceListDetailDocument } from './PriceListDetailDocument.js';
import type { PriceListDetailPdfViewModel } from './buildPriceListDetailViewModel.js';

function makeViewModel(overrides: Partial<PriceListDetailPdfViewModel> = {}): PriceListDetailPdfViewModel {
  return {
    title: 'PRICE LIST',
    subtitle: 'PL-2026-000001 — FY 2026 Prices',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Price List Code', value: 'PL-2026-000001' },
      { label: 'Distributor', value: 'Acme Distributors' },
      { label: 'MRP Percentage (%)', value: '60.00' },
      { label: 'Status', value: 'Active' },
      { label: 'Effective From', value: '01 Jan 2026' },
      { label: 'Effective To', value: 'Open-ended' },
    ],
    ...overrides,
  };
}

describe('PriceListDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<PriceListDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a zero-formatted percentage without throwing', async () => {
    const viewModel = makeViewModel({
      identityItems: [{ label: 'MRP Percentage (%)', value: '0.00' }],
    });
    const blob = await pdf(<PriceListDetailDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a bounded effective period without throwing', async () => {
    const viewModel = makeViewModel({
      identityItems: [
        { label: 'Effective From', value: '01 Jan 2026' },
        { label: 'Effective To', value: '31 Dec 2026' },
      ],
    });
    const blob = await pdf(<PriceListDetailDocument viewModel={viewModel} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
