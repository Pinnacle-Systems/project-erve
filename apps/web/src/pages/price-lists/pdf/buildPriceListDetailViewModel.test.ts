import { describe, expect, it } from 'vitest';
import type { PriceList } from '../types.js';
import { buildPriceListDetailViewModel } from './buildPriceListDetailViewModel.js';

function makePriceList(overrides: Partial<PriceList> = {}): PriceList {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
    percentageOfMrp: 60,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPriceListDetailViewModel', () => {
  it('maps header identity fields', () => {
    const vm = buildPriceListDetailViewModel(makePriceList(), { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.title).toBe('PRICE LIST');
    expect(vm.subtitle).toBe('PL-2026-000001 — FY 2026 Prices');
    expect(vm.identityItems).toContainEqual({ label: 'Price List Code', value: 'PL-2026-000001' });
    expect(vm.identityItems).toContainEqual({ label: 'Distributor', value: 'Acme Distributors' });
    expect(vm.identityItems).toContainEqual({ label: 'Status', value: 'Active' });
  });

  it('shows "Open-ended" for a null effectiveTo', () => {
    const vm = buildPriceListDetailViewModel(makePriceList({ effectiveTo: null }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'Effective To', value: 'Open-ended' });
  });

  it('formats a non-null effectiveTo as a date', () => {
    const vm = buildPriceListDetailViewModel(makePriceList({ effectiveTo: '2026-12-31' }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    const effectiveTo = vm.identityItems.find((item) => item.label === 'Effective To');
    expect(effectiveTo?.value).not.toBe('Open-ended');
    expect(String(effectiveTo?.value)).toMatch(/2026/);
  });

  it('formats the MRP percentage to two decimal places', () => {
    const vm = buildPriceListDetailViewModel(makePriceList({ percentageOfMrp: 57.5 }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'MRP Percentage (%)', value: '57.50' });
  });

  it('preserves a zero percentage as "0.00", not a null-style em dash', () => {
    const vm = buildPriceListDetailViewModel(makePriceList({ percentageOfMrp: 0 }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({ label: 'MRP Percentage (%)', value: '0.00' });
  });

  it('does not leak fields beyond the declared shape (security boundary)', () => {
    // A fixture cast with extra, unexpected fields (an internal cost field on the price list)
    // must never reach the printed document merely because the source object carries it — the
    // mapping is an explicit allowlist, never `...priceList`.
    const tainted = { ...makePriceList(), internalCostBasis: 999 } as unknown as PriceList;

    const vm = buildPriceListDetailViewModel(tainted, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(JSON.stringify(vm)).not.toContain('internalCostBasis');
  });
});
