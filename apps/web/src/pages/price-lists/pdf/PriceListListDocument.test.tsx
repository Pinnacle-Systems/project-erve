import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PriceListListDocument } from './PriceListListDocument.js';
import type { PriceListListPdfRow, PriceListListPdfViewModel } from './buildPriceListListViewModel.js';

function makeRow(overrides: Partial<PriceListListPdfRow> = {}): PriceListListPdfRow {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributorName: 'Acme Distributors',
    effectiveFrom: '01 Jan 2026',
    effectiveTo: 'Open-ended',
    lineCount: 3,
    status: 'Active',
    ...overrides,
  };
}

function makeViewModel(rows: PriceListListPdfRow[]): PriceListListPdfViewModel {
  return {
    title: 'PRICE LIST MASTER LIST',
    subtitle: 'Distributor-specific selling prices with effective periods',
    filters: [],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('PriceListListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<PriceListListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<PriceListListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero line count as "0", not an em dash', async () => {
    const rows = [makeRow({ lineCount: 0 })];
    const blob = await pdf(<PriceListListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ id: `pl-${i}`, code: `PL-2026-${i}` }));
    const blob = await pdf(<PriceListListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders active filters without throwing', async () => {
    const vm = { ...makeViewModel([makeRow()]), filters: [{ label: 'Status', value: 'Active' }] };
    const blob = await pdf(<PriceListListDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
