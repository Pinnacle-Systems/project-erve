import { describe, expect, it } from 'vitest';
import type { PriceListSummary } from '../types.js';
import { buildPriceListListViewModel } from './buildPriceListListViewModel.js';

function makePriceList(overrides: Partial<PriceListSummary> = {}): PriceListSummary {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    lineCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPriceListListViewModel', () => {
  it('maps price lists into rows and preserves API row order', () => {
    const priceLists = [makePriceList({ id: 'a' }), makePriceList({ id: 'b' })];
    const vm = buildPriceListListViewModel(priceLists, {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(vm.totalCount).toBe(2);
  });

  it('handles an empty price list', () => {
    const vm = buildPriceListListViewModel([], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('renders "Open-ended" for a null effectiveTo, distinct from a formatted date', () => {
    const vm = buildPriceListListViewModel(
      [makePriceList({ effectiveTo: null })],
      {},
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.rows[0]!.effectiveTo).toBe('Open-ended');
  });

  it('formats a non-null effectiveTo as a date, not "Open-ended"', () => {
    const vm = buildPriceListListViewModel(
      [makePriceList({ effectiveTo: '2026-12-31' })],
      {},
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.rows[0]!.effectiveTo).not.toBe('Open-ended');
    expect(vm.rows[0]!.effectiveTo).toMatch(/2026/);
  });

  it('preserves a zero line count rather than treating it as missing', () => {
    const vm = buildPriceListListViewModel(
      [makePriceList({ lineCount: 0 })],
      {},
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.rows[0]!.lineCount).toBe(0);
  });

  it('maps status through the shared display labels (EXPIRED -> Retired)', () => {
    const vm = buildPriceListListViewModel(
      [makePriceList({ status: 'EXPIRED' })],
      {},
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.rows[0]!.status).toBe('Retired');
  });

  it('represents active search/status/distributor filters in the filter summary', () => {
    const vm = buildPriceListListViewModel(
      [],
      { search: 'PL-2026', status: 'ACTIVE', distributorName: 'Acme Distributors' },
      { generatedAt: '2026-09-12T00:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'PL-2026' },
      { label: 'Status', value: 'Active' },
      { label: 'Distributor', value: 'Acme Distributors' },
    ]);
  });

  it('leaves filter values empty when no filter is active', () => {
    const vm = buildPriceListListViewModel([], {}, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.filters.every((filter) => filter.value === '')).toBe(true);
  });

  it('carries through generatedBy when provided', () => {
    const vm = buildPriceListListViewModel(
      [],
      {},
      { generatedAt: '2026-09-12T00:00:00Z', generatedBy: 'Test Admin' },
    );
    expect(vm.generatedBy).toBe('Test Admin');
  });

  it('does not leak fields beyond the declared row shape (security boundary)', () => {
    // A row cast with extra, unexpected fields (e.g. a future API addition, or an internal
    // field a fixture happens to carry) must never reach the printed document merely because
    // the source object has it — the mapping is an explicit allowlist, never a spread.
    const tainted = {
      ...makePriceList(),
      internalCostBasis: 999,
      distributor: { ...makePriceList().distributor, internalMargin: 42 },
    } as unknown as PriceListSummary;

    const vm = buildPriceListListViewModel([tainted], {}, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(Object.keys(vm.rows[0]!).sort()).toEqual(
      ['id', 'code', 'name', 'distributorName', 'effectiveFrom', 'effectiveTo', 'lineCount', 'status'].sort(),
    );
  });
});
