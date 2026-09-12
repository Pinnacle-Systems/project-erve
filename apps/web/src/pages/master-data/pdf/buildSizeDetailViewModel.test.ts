import { describe, expect, it } from 'vitest';
import type { Size } from '../types.js';
import { buildSizeDetailViewModel } from './buildSizeDetailViewModel.js';

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

describe('buildSizeDetailViewModel', () => {
  it('maps the identity fields', () => {
    const vm = buildSizeDetailViewModel(makeSize(), { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.identityItems).toEqual([
      { label: 'Code', value: 'AGE_3' },
      { label: 'Label', value: '3 years' },
      { label: 'Type', value: 'AGE' },
      { label: 'Sort Order', value: 3 },
      { label: 'Status', value: 'ACTIVE' },
    ]);
  });

  it('maps the usage counts when present', () => {
    const vm = buildSizeDetailViewModel(
      makeSize({ usage: { styleMappings: 2, purchaseOrderLines: 5, jobOrderLines: 1 } }),
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.usageItems).toEqual([
      { label: 'Style mappings', value: 2 },
      { label: 'Order Sheet lines', value: 5 },
      { label: 'Job-order lines', value: 1 },
    ]);
  });

  it('defaults usage counts to zero when the record has no usage field', () => {
    const vm = buildSizeDetailViewModel(makeSize({ usage: undefined }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.usageItems).toEqual([
      { label: 'Style mappings', value: 0 },
      { label: 'Order Sheet lines', value: 0 },
      { label: 'Job-order lines', value: 0 },
    ]);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildSizeDetailViewModel(makeSize(), {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
