import { describe, expect, it } from 'vitest';
import type { Style } from '../types.js';
import { buildStyleDetailViewModel } from './buildStyleDetailViewModel.js';
import type { PreparedStyleDetailPdfData } from './prepareStyleDetailPdfData.js';

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    description: 'A basic tee',
    categoryDescription: 'Apparel',
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: 'Blue',
    lmixNumber: null,
    hsnCode: '6109',
    hsnDescription: 'Cotton knit',
    finalMrp: 499,
    royaltyPercentage: 5,
    status: 'ACTIVE',
    season: {
      id: 's1',
      code: 'SS27',
      name: 'Spring Summer 27',
      financialYear: { id: 'fy1', code: 'FY27' },
      displayName: 'SS27',
      status: 'ACTIVE',
    },
    sizes: [],
    factories: [],
    images: [],
    ...overrides,
  };
}

describe('buildStyleDetailViewModel', () => {
  it('maps identity fields, season label, sizes, and factory rows', () => {
    const style = makeStyle({
      sizes: [{ id: 'sz1', code: 'M', label: 'Medium', sizeType: 'ALPHA', sortOrder: 1, status: 'ACTIVE', mappingStatus: 'ACTIVE', importedSizeRangeLabel: null }],
      factories: [{ id: 'f1', code: 'F1', name: 'Factory One', contactName: null, contactEmail: null, contactPhone: null, city: null, status: 'ACTIVE', mappingStatus: 'ACTIVE', exFactoryPrice: 250.5 }],
    });
    const prepared: PreparedStyleDetailPdfData = { style, primaryImage: { placeholder: true } };

    const vm = buildStyleDetailViewModel(prepared, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(vm.subtitle).toBe('STY-0001 — Basic Tee');
    expect(vm.seasonLabel).toBe('SS27 — Spring Summer 27');
    expect(vm.sizeLabels).toEqual(['M']);
    expect(vm.factoryRows).toEqual([{ id: 'f1', name: 'Factory One', exFactoryPrice: '250.50' }]);
    expect(vm.identityItems.find((i) => i.label === 'Style Number')?.value).toBe('STY-0001');
    expect(vm.identityItems.find((i) => i.label === 'Final MRP')?.value).toBe('499.00');
  });

  it('passes through the resolved primary image (or its placeholder marker) unchanged', () => {
    const withImage = buildStyleDetailViewModel(
      { style: makeStyle(), primaryImage: { dataUri: 'data:image/jpeg;base64,xyz' } },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(withImage.image).toEqual({ dataUri: 'data:image/jpeg;base64,xyz' });

    const withPlaceholder = buildStyleDetailViewModel(
      { style: makeStyle(), primaryImage: { placeholder: true } },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(withPlaceholder.image).toEqual({ placeholder: true });
  });

  it('handles a style with no sizes and no factory mappings', () => {
    const vm = buildStyleDetailViewModel(
      { style: makeStyle({ sizes: [], factories: [] }), primaryImage: { placeholder: true } },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.sizeLabels).toEqual([]);
    expect(vm.factoryRows).toEqual([]);
  });

  it('null royalty percentage flows through as undefined for the em-dash formatter to handle', () => {
    const vm = buildStyleDetailViewModel(
      { style: makeStyle({ royaltyPercentage: null }), primaryImage: { placeholder: true } },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.identityItems.find((i) => i.label === 'Royalty %')?.value).toBeUndefined();
  });
});
