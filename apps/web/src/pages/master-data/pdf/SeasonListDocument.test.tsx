import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { SeasonListDocument } from './SeasonListDocument.js';
import type { SeasonListPdfRow, SeasonListPdfViewModel } from './buildSeasonListViewModel.js';

function makeRow(overrides: Partial<SeasonListPdfRow> = {}): SeasonListPdfRow {
  return {
    id: 'season-1',
    code: 'SS26',
    name: 'Summer 26',
    financialYearCode: '26-27',
    displayName: 'SS26 26-27',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: SeasonListPdfRow[]): SeasonListPdfViewModel {
  return {
    title: 'SEASON MASTER LIST',
    subtitle: 'Season master records',
    filters: [{ label: 'Financial Year', value: '' }],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('SeasonListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<SeasonListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<SeasonListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeRow({ id: `season-${i}`, code: `SS${String(i).padStart(2, '0')}` }),
    );
    const blob = await pdf(<SeasonListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders the active Financial Year filter chip', async () => {
    const vm = { ...makeViewModel([]), filters: [{ label: 'Financial Year', value: '26-27' }] };
    const blob = await pdf(<SeasonListDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
