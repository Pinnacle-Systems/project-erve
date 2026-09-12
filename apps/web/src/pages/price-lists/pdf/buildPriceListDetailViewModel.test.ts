import { describe, expect, it } from 'vitest';
import type { PriceList } from '../types.js';
import { buildPriceListDetailViewModel } from './buildPriceListDetailViewModel.js';

function makePriceList(overrides: Partial<PriceList> = {}): PriceList {
  return {
    id: 'pl-1',
    code: 'PL-2026-000001',
    name: 'FY 2026 Prices',
    distributor: { id: 'dist-1', code: 'DIST-1', name: 'Acme Distributors', status: 'ACTIVE' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    lineCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: '39026006',
        styleName: 'BOYS REGULAR TSHIRT',
        styleStatus: 'ACTIVE',
        unitPrice: 249.5,
        currency: 'INR',
      },
    ],
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

  it('maps rate lines with Style Number, Style Name, and formatted Unit Price', () => {
    const vm = buildPriceListDetailViewModel(makePriceList(), { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.lines).toEqual([
      { id: 'line-1', styleNumber: '39026006', styleName: 'BOYS REGULAR TSHIRT', unitPrice: 'INR 249.50' },
    ]);
  });

  it('preserves a zero unit price as "INR 0.00", not a null-style em dash', () => {
    const priceList = makePriceList({
      lines: [
        {
          id: 'line-1',
          styleId: 'style-1',
          styleNumber: '39026006',
          styleName: 'BOYS REGULAR TSHIRT',
          styleStatus: 'ACTIVE',
          unitPrice: 0,
          currency: 'INR',
        },
      ],
    });
    const vm = buildPriceListDetailViewModel(priceList, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.lines[0]!.unitPrice).toBe('INR 0.00');
  });

  it('formats a non-INR currency with its code rather than assuming rupees', () => {
    const priceList = makePriceList({
      lines: [
        {
          id: 'line-1',
          styleId: 'style-1',
          styleNumber: '39026006',
          styleName: 'BOYS REGULAR TSHIRT',
          styleStatus: 'ACTIVE',
          unitPrice: 10,
          currency: 'USD',
        },
      ],
    });
    const vm = buildPriceListDetailViewModel(priceList, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.lines[0]!.unitPrice).toBe('USD 10.00');
  });

  it('preserves line order as returned by the API', () => {
    const priceList = makePriceList({
      lines: [
        { id: 'l1', styleId: 's1', styleNumber: 'A', styleName: 'A', styleStatus: 'ACTIVE', unitPrice: 1, currency: 'INR' },
        { id: 'l2', styleId: 's2', styleNumber: 'B', styleName: 'B', styleStatus: 'ACTIVE', unitPrice: 2, currency: 'INR' },
      ],
    });
    const vm = buildPriceListDetailViewModel(priceList, { generatedAt: '2026-09-12T00:00:00Z' });
    expect(vm.lines.map((line) => line.id)).toEqual(['l1', 'l2']);
  });

  it('handles a price list with no lines', () => {
    const vm = buildPriceListDetailViewModel(makePriceList({ lines: [], lineCount: 0 }), {
      generatedAt: '2026-09-12T00:00:00Z',
    });
    expect(vm.lines).toEqual([]);
    expect(vm.identityItems).toContainEqual({ label: 'Lines', value: 0 });
  });

  it('does not leak fields beyond the declared shape (security boundary)', () => {
    // A fixture cast with extra, unexpected fields (an internal cost field on the price list,
    // an internal margin on a line) must never reach the printed document merely because the
    // source object carries it — the mapping is an explicit allowlist, never `...priceList` /
    // `...line`.
    const tainted = {
      ...makePriceList(),
      internalCostBasis: 999,
      lines: [{ ...makePriceList().lines[0]!, internalMargin: 42, styleStatus: 'ACTIVE' as const }],
    } as unknown as PriceList;

    const vm = buildPriceListDetailViewModel(tainted, { generatedAt: '2026-09-12T00:00:00Z' });

    expect(Object.keys(vm.lines[0]!).sort()).toEqual(['id', 'styleNumber', 'styleName', 'unitPrice'].sort());
    expect(JSON.stringify(vm)).not.toContain('internalCostBasis');
    expect(JSON.stringify(vm)).not.toContain('internalMargin');
  });
});
