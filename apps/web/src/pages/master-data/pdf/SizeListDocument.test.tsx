import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { SizeListDocument } from './SizeListDocument.js';
import type { SizeListPdfRow, SizeListPdfViewModel } from './buildSizeListViewModel.js';

function makeRow(overrides: Partial<SizeListPdfRow> = {}): SizeListPdfRow {
  return {
    id: 'size-1',
    code: 'AGE_3',
    label: '3 years',
    sizeType: 'AGE',
    sortOrder: 3,
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: SizeListPdfRow[]): SizeListPdfViewModel {
  return {
    title: 'SIZE MASTER LIST',
    subtitle: 'Size codes available for style mapping',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('SizeListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<SizeListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<SizeListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeRow({ id: `size-${i}`, code: `AGE_${i}`, sortOrder: i }),
    );
    const blob = await pdf(<SizeListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
