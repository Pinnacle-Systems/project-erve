import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { SizeDetailDocument } from './SizeDetailDocument.js';
import type { SizeDetailPdfViewModel } from './buildSizeDetailViewModel.js';

function makeViewModel(overrides: Partial<SizeDetailPdfViewModel> = {}): SizeDetailPdfViewModel {
  return {
    title: 'SIZE MASTER',
    subtitle: 'AGE_3 — 3 years',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Code', value: 'AGE_3' },
      { label: 'Label', value: '3 years' },
      { label: 'Type', value: 'AGE' },
      { label: 'Sort Order', value: 3 },
      { label: 'Status', value: 'ACTIVE' },
    ],
    usageItems: [
      { label: 'Style mappings', value: 2 },
      { label: 'Order Sheet lines', value: 0 },
      { label: 'Job-order lines', value: 1 },
    ],
    ...overrides,
  };
}

describe('SizeDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<SizeDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders null identity values as an em dash without throwing', async () => {
    const vm = makeViewModel({ identityItems: [{ label: 'Sort Order', value: null }] });
    const blob = await pdf(<SizeDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
