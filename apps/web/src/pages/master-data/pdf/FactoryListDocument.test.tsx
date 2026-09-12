import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryListDocument } from './FactoryListDocument.js';
import type { FactoryListPdfRow, FactoryListPdfViewModel } from './buildFactoryListViewModel.js';

function makeRow(overrides: Partial<FactoryListPdfRow> = {}): FactoryListPdfRow {
  return {
    id: 'factory-1',
    code: 'FAC-1',
    name: 'Acme Factory',
    contactName: 'Jane Doe',
    contactEmail: 'jane@acme.test',
    contactPhone: '9999999999',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: FactoryListPdfRow[]): FactoryListPdfViewModel {
  return {
    title: 'FACTORY MASTER LIST',
    subtitle: 'Factory master records and contacts',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('FactoryListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<FactoryListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<FactoryListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders null contact fields as an em dash without throwing', async () => {
    const rows = [makeRow({ contactName: null, contactEmail: null, contactPhone: null })];
    const blob = await pdf(<FactoryListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ id: `factory-${i}`, code: `FAC-${i}` }));
    const blob = await pdf(<FactoryListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
