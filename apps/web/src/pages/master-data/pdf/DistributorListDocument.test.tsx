import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DistributorListDocument } from './DistributorListDocument.js';
import type {
  DistributorListPdfRow,
  DistributorListPdfViewModel,
} from './buildDistributorListViewModel.js';

function makeRow(overrides: Partial<DistributorListPdfRow> = {}): DistributorListPdfRow {
  return {
    id: 'dist-1',
    code: 'DIST-1',
    name: 'Acme Distribution',
    contactName: 'Jane Doe',
    city: 'Mumbai',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: DistributorListPdfRow[]): DistributorListPdfViewModel {
  return {
    title: 'DISTRIBUTOR MASTER LIST',
    subtitle: 'Distributor master records and contacts',
    filters: [{ label: 'Search', value: '' }, { label: 'Status', value: '' }],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('DistributorListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<DistributorListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<DistributorListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders the active filter chips', async () => {
    const vm = { ...makeViewModel([]), filters: [{ label: 'Search', value: 'DIST' }, { label: 'Status', value: 'ACTIVE' }] };
    const blob = await pdf(<DistributorListDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ id: `dist-${i}`, code: `DIST-${i}` }));
    const blob = await pdf(<DistributorListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
