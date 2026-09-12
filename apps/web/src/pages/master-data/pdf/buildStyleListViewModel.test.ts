import { describe, expect, it } from 'vitest';
import type { Style } from '../types.js';
import { buildStyleListViewModel } from './buildStyleListViewModel.js';
import type { PreparedStyleListPdfData } from './prepareStyleListPdfData.js';

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    description: null,
    categoryDescription: null,
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: null,
    lmixNumber: null,
    hsnCode: '6109',
    hsnDescription: null,
    finalMrp: 499,
    royaltyPercentage: null,
    status: 'ACTIVE',
    season: { id: 's1', code: 'SS27', name: 'Spring Summer 27', financialYear: { id: 'fy1', code: 'FY27' }, displayName: 'SS27', status: 'ACTIVE' },
    sizes: [],
    factories: [],
    images: [],
    ...overrides,
  };
}

describe('buildStyleListViewModel', () => {
  it('maps styles into rows carrying the resolved image, and preserves API row order', () => {
    const styles = [makeStyle({ id: 'a', styleNumber: 'STY-A' }), makeStyle({ id: 'b', styleNumber: 'STY-B' })];
    const prepared: PreparedStyleListPdfData = {
      styles,
      images: new Map([
        ['a', { dataUri: 'data:image/jpeg;base64,aaa' }],
        ['b', { placeholder: true }],
      ]),
    };

    const vm = buildStyleListViewModel(prepared, {}, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.rows[0]!.image).toEqual({ dataUri: 'data:image/jpeg;base64,aaa' });
    expect(vm.rows[1]!.image).toEqual({ placeholder: true });
    expect(vm.totalCount).toBe(2);
  });

  it('falls back to a placeholder marker for a style with no resolved image entry', () => {
    const prepared: PreparedStyleListPdfData = { styles: [makeStyle()], images: new Map() };
    const vm = buildStyleListViewModel(prepared, {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows[0]!.image).toEqual({ placeholder: true });
  });

  it('propagates active search/status filters into the filter summary', () => {
    const prepared: PreparedStyleListPdfData = { styles: [], images: new Map() };
    const vm = buildStyleListViewModel(
      prepared,
      { search: 'STY-001', status: 'ACTIVE' },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'STY-001' },
      { label: 'Status', value: 'ACTIVE' },
    ]);
  });

  it('handles an empty style list', () => {
    const prepared: PreparedStyleListPdfData = { styles: [], images: new Map() };
    const vm = buildStyleListViewModel(prepared, {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('carries through generatedBy when provided', () => {
    const prepared: PreparedStyleListPdfData = { styles: [], images: new Map() };
    const vm = buildStyleListViewModel(
      prepared,
      {},
      { generatedAt: '2026-09-12T00:00:00Z', generatedBy: 'Test Admin' },
    );
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
