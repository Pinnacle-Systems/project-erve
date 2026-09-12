import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { DistributorDetailDocument } from './DistributorDetailDocument.js';
import type { DistributorDetailPdfViewModel } from './buildDistributorDetailViewModel.js';

function makeViewModel(
  overrides: Partial<DistributorDetailPdfViewModel> = {},
): DistributorDetailPdfViewModel {
  return {
    title: 'DISTRIBUTOR MASTER',
    subtitle: 'DIST-1 — Acme Distribution',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Code', value: 'DIST-1' },
      { label: 'Name', value: 'Acme Distribution' },
      { label: 'GSTIN', value: '27AAAAA0000A1Z5' },
      { label: 'Purchase Mode', value: 'Outright' },
      { label: 'Address Line 2', value: null },
    ],
    ...overrides,
  };
}

describe('DistributorDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<DistributorDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders null address values as an em dash without throwing', async () => {
    const vm = makeViewModel({ identityItems: [{ label: 'Address Line 1', value: null }] });
    const blob = await pdf(<DistributorDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
