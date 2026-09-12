import { describe, expect, it } from 'vitest';
import type { Size } from '../types.js';
import { buildSizeListViewModel } from './buildSizeListViewModel.js';

function makeSize(overrides: Partial<Size> = {}): Size {
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

describe('buildSizeListViewModel', () => {
  it('maps sizes into rows and preserves API row order', () => {
    const sizes = [makeSize({ id: 'a', code: 'AGE_1', sortOrder: 1 }), makeSize({ id: 'b', code: 'AGE_2', sortOrder: 2 })];
    const vm = buildSizeListViewModel(sizes, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.totalCount).toBe(2);
  });

  it('formats the underscore size type into a readable label', () => {
    const vm = buildSizeListViewModel([makeSize({ sizeType: 'FREE_SIZE' })], {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.rows[0]!.sizeType).toBe('FREE SIZE');
  });

  it('handles an empty size list', () => {
    const vm = buildSizeListViewModel([], { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildSizeListViewModel([], { generatedAt: '2026-09-12T00:00:00Z', generatedBy: 'Test Admin' });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
