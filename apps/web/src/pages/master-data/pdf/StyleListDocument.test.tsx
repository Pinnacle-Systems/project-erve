import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { StyleListDocument } from './StyleListDocument.js';
import type { StyleListPdfRow, StyleListPdfViewModel } from './buildStyleListViewModel.js';

function makeRow(overrides: Partial<StyleListPdfRow> = {}): StyleListPdfRow {
  return {
    id: 'style-1',
    image: { placeholder: true },
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    seasonLabel: 'SS27',
    hsnCode: '6109',
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeViewModel(rows: StyleListPdfRow[]): StyleListPdfViewModel {
  return {
    title: 'STYLE MASTER LIST',
    subtitle: 'Item master records',
    filters: [{ label: 'Search', value: '' }],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('StyleListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows (multi-page) without throwing', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      makeRow({ id: `style-${i}`, styleNumber: `STY-${String(i).padStart(4, '0')}` }),
    );
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a mix of resolved images and placeholders without throwing', async () => {
    const rows = [
      makeRow({ id: 'a', image: { dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }),
      makeRow({ id: 'b', image: { placeholder: true } }),
    ];
    const blob = await pdf(<StyleListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
