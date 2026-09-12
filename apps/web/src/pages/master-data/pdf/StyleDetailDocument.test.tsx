import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { StyleDetailDocument } from './StyleDetailDocument.js';
import type { StyleDetailPdfViewModel } from './buildStyleDetailViewModel.js';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeViewModel(overrides: Partial<StyleDetailPdfViewModel> = {}): StyleDetailPdfViewModel {
  return {
    title: 'STYLE MASTER',
    subtitle: 'STY-0001 — Basic Tee',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    image: { placeholder: true },
    identityItems: [
      { label: 'Style Number', value: 'STY-0001' },
      { label: 'Final MRP', value: '499.00' },
      { label: 'Royalty %', value: undefined },
    ],
    seasonLabel: 'SS27 — Spring Summer 27',
    sizeLabels: ['S', 'M', 'L'],
    factoryRows: [{ id: 'f1', name: 'Factory One', exFactoryPrice: '250.50' }],
    ...overrides,
  };
}

describe('StyleDetailDocument', () => {
  it('renders with a placeholder image without throwing', async () => {
    const blob = await pdf(<StyleDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders with a resolved image without throwing', async () => {
    const blob = await pdf(
      <StyleDetailDocument viewModel={makeViewModel({ image: { dataUri: TINY_PNG } })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with no sizes and no factory mappings (both empty sections omitted/handled) without throwing', async () => {
    const blob = await pdf(
      <StyleDetailDocument viewModel={makeViewModel({ sizeLabels: [], factoryRows: [] })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with a null-ish (em-dash) identity value without throwing', async () => {
    const blob = await pdf(
      <StyleDetailDocument
        viewModel={makeViewModel({ identityItems: [{ label: 'Description', value: undefined }] })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
