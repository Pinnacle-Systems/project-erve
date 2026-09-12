import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryDetailDocument } from './FactoryDetailDocument.js';
import type { FactoryDetailPdfViewModel } from './buildFactoryDetailViewModel.js';

function makeViewModel(overrides: Partial<FactoryDetailPdfViewModel> = {}): FactoryDetailPdfViewModel {
  return {
    title: 'FACTORY MASTER',
    subtitle: 'FAC-1 — Acme Factory',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Code', value: 'FAC-1' },
      { label: 'Name', value: 'Acme Factory' },
      { label: 'Status', value: 'ACTIVE' },
      { label: 'Contact Email', value: null },
    ],
    usageItems: [
      { label: 'Style mappings', value: 2 },
      { label: 'Job orders', value: 4 },
      { label: 'Mapped users', value: 1 },
    ],
    ...overrides,
  };
}

describe('FactoryDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<FactoryDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders null address values as an em dash without throwing', async () => {
    const vm = makeViewModel({ identityItems: [{ label: 'Address Line 2', value: null }] });
    const blob = await pdf(<FactoryDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
