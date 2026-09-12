import { describe, expect, it } from 'vitest';
import type { DistributorSummary } from '../types.js';
import { buildDistributorListViewModel } from './buildDistributorListViewModel.js';

function makeDistributor(overrides: Partial<DistributorSummary> = {}): DistributorSummary {
  return {
    id: 'dist-1',
    code: 'DIST-1',
    name: 'Acme Distribution',
    contactName: 'Jane Doe',
    city: 'Mumbai',
    status: 'ACTIVE',
    ...overrides,
  };
}

describe('buildDistributorListViewModel', () => {
  it('maps distributors into rows and preserves API row order', () => {
    const distributors = [makeDistributor({ id: 'a' }), makeDistributor({ id: 'b' })];
    const vm = buildDistributorListViewModel(distributors, {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.totalCount).toBe(2);
  });

  it('does not include GSTIN or Purchase Mode (not part of the list endpoint response)', () => {
    const vm = buildDistributorListViewModel([makeDistributor()], {}, {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.rows[0]).not.toHaveProperty('gstin');
    expect(vm.rows[0]).not.toHaveProperty('purchaseMode');
  });

  it('propagates active search/status filters into the filter summary', () => {
    const vm = buildDistributorListViewModel(
      [],
      { search: 'DIST-1', status: 'ACTIVE' },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'DIST-1' },
      { label: 'Status', value: 'ACTIVE' },
    ]);
  });

  it('handles an empty distributor list', () => {
    const vm = buildDistributorListViewModel([], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildDistributorListViewModel([], {}, {
      generatedAt: '2026-09-12T00:00:00Z',
      generatedBy: 'Test Admin',
    });
    expect(vm.generatedBy).toBe('Test Admin');
  });
});
