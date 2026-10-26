import { describe, expect, it } from 'vitest';
import {
  distinctSizeColumns,
  groupFinancialLinesByStyle,
  groupLinesByStyle,
  groupReceiptLinesByStyle,
  type FinancialStyleSizeLine,
  type ReceiptTraceableLine,
  type StyleSizeQuantityLine,
} from './style-size-grouping.js';

function makeLine(overrides: Partial<StyleSizeQuantityLine> = {}): StyleSizeQuantityLine {
  return {
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10,
    ...overrides,
  };
}

describe('canonical Size ordering compatibility', () => {
  const lines = [
    { ...makeLine({ sizeId: 'missing', sizeCode: 'A' }), sizeSortOrder: undefined },
    { ...makeLine({ sizeId: 'large', sizeCode: 'L' }), sizeSortOrder: 2 },
    { ...makeLine({ sizeId: 'small', sizeCode: 'S' }), sizeSortOrder: -1 },
    { ...makeLine({ sizeId: 'medium', sizeCode: 'M' }), sizeSortOrder: 0 },
    { ...makeLine({ sizeId: 'equal', sizeCode: 'B' }), sizeSortOrder: 2 },
  ];

  it('orders matrix columns by finite rank then code with missing ranks last', () => {
    expect(distinctSizeColumns(lines).map((size) => size.sizeId)).toEqual(['small', 'medium', 'equal', 'large', 'missing']);
  });

  it('orders compact breakdowns identically without changing totals or Style order', () => {
    const grouped = groupLinesByStyle(lines);
    expect(grouped[0]!.sizeEntries.map((size) => size.sizeId)).toEqual(['small', 'medium', 'equal', 'large', 'missing']);
    expect(grouped[0]!.totalQuantity).toBe(50);
    expect(lines[0]!.sizeId).toBe('missing');
  });

  it('orders financial breakdowns while preserving rate groups and authoritative amounts', () => {
    const financial = lines.map((line, index) => ({ ...line, id: String(index), unitRate: 2, defaultRate: 2, lineAmount: 19.99 }));
    const grouped = groupFinancialLinesByStyle(financial);
    expect(grouped[0]!.sizeEntries.map((size) => size.sizeId)).toEqual(['small', 'medium', 'equal', 'large', 'missing']);
    expect(grouped[0]!.amount).toBe(financial.reduce((sum, line) => sum + line.lineAmount, 0));
  });

  it('retains legacy first appearance when no finite metadata exists', () => {
    const legacy = lines.map((line) => ({ ...line, sizeSortOrder: Number.NaN }));
    expect(distinctSizeColumns(legacy).map((size) => size.sizeId)).toEqual(lines.map((line) => line.sizeId));
  });

  it('preserves Style first appearance even when their Sizes rank in the opposite order', () => {
    const groups = groupLinesByStyle([
      { ...makeLine({ styleId: 'first', sizeId: 'large', sizeCode: 'L' }), sizeSortOrder: 2 },
      { ...makeLine({ styleId: 'second', sizeId: 'small', sizeCode: 'S' }), sizeSortOrder: 0 },
    ]);
    expect(groups.map((group) => group.styleId)).toEqual(['first', 'second']);
  });

  it('uses available metadata from a duplicate Size without duplicating columns or quantities', () => {
    const duplicate = [...lines, { ...lines[0]!, sizeSortOrder: -2 }];
    expect(distinctSizeColumns(duplicate).map((size) => size.sizeId)).toEqual(['missing', 'small', 'medium', 'equal', 'large']);
    expect(groupLinesByStyle(duplicate)[0]!.sizeEntries[0]).toMatchObject({ sizeId: 'missing', quantity: 20 });
  });
});

describe('groupLinesByStyle', () => {
  it('groups by stable styleId, not by display text', () => {
    // Two lines share the same styleNumber/styleName text but have
    // different styleId — they must NOT be merged into one row.
    const lines = [
      makeLine({ styleId: 'style-a', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', quantity: 5 }),
      makeLine({ styleId: 'style-b', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', quantity: 7 }),
    ];
    const groups = groupLinesByStyle(lines);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.styleId)).toEqual(['style-a', 'style-b']);
    expect(groups[0]?.totalQuantity).toBe(5);
    expect(groups[1]?.totalQuantity).toBe(7);
  });

  it('merges lines that share a styleId even if their styleNumber/styleName text differs (uses the first-seen display text)', () => {
    // Defensive: styleId is authoritative identity, never recomputed from
    // display text — a stale/inconsistent styleNumber on a later line must
    // not fork a second row for the same Style.
    const lines = [
      makeLine({ styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', quantity: 3 }),
      makeLine({ styleId: 'style-1', styleNumber: 'ST-001-STALE', styleName: 'Renamed Tee', sizeId: 'size-2', quantity: 4 }),
    ];
    const groups = groupLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee' });
    expect(groups[0]?.totalQuantity).toBe(7);
  });

  it('aggregates by stable sizeId within a Style, not by sizeCode/sizeLabel text', () => {
    // Two Sizes with the same code/label text but different sizeId must
    // remain two separate entries — sizeId is the identity, not the label.
    const lines = [
      makeLine({ sizeId: 'size-a', sizeCode: 'M', sizeLabel: 'Medium', quantity: 3 }),
      makeLine({ sizeId: 'size-b', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4 }),
    ];
    const groups = groupLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sizeEntries).toHaveLength(2);
    expect(groups[0]?.sizeEntries.map((e) => e.sizeId)).toEqual(['size-a', 'size-b']);
  });

  it('sums duplicate Style+Size (same styleId, same sizeId) lines into one entry rather than a second entry', () => {
    const lines = [
      makeLine({ sizeId: 'size-1', quantity: 4 }),
      makeLine({ sizeId: 'size-1', quantity: 6 }),
    ];
    const groups = groupLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sizeEntries).toEqual([{ sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10 }]);
    expect(groups[0]?.totalQuantity).toBe(10);
  });

  it('preserves Style and Size first-appearance order', () => {
    const lines = [
      makeLine({ styleId: 'style-2', sizeId: 'size-b', sizeCode: 'L', quantity: 1 }),
      makeLine({ styleId: 'style-1', sizeId: 'size-a', sizeCode: 'S', quantity: 2 }),
      makeLine({ styleId: 'style-2', sizeId: 'size-c', sizeCode: 'XL', quantity: 3 }),
      makeLine({ styleId: 'style-1', sizeId: 'size-b', sizeCode: 'L', quantity: 4 }),
    ];
    const groups = groupLinesByStyle(lines);
    expect(groups.map((g) => g.styleId)).toEqual(['style-2', 'style-1']);
    expect(groups[0]?.sizeEntries.map((e) => e.sizeId)).toEqual(['size-b', 'size-c']);
    expect(groups[1]?.sizeEntries.map((e) => e.sizeId)).toEqual(['size-a', 'size-b']);
  });

  it('two independent calls never interfere with each other (no shared/leaked state across separate cartons or destinations)', () => {
    // Calling this once per carton (as PackingListPage.tsx and the two PDF
    // builders do) must never let one carton's Style+Size totals bleed into
    // another's — the function itself carries no module-level state, only
    // a fresh Map/array per call.
    const cartonALines = [makeLine({ styleId: 'style-1', sizeId: 'size-1', quantity: 5 })];
    const cartonBLines = [makeLine({ styleId: 'style-1', sizeId: 'size-1', quantity: 9 })];

    const groupsA = groupLinesByStyle(cartonALines);
    const groupsB = groupLinesByStyle(cartonBLines);

    expect(groupsA[0]?.totalQuantity).toBe(5);
    expect(groupsB[0]?.totalQuantity).toBe(9);

    // Re-running the first call again produces the same result — proves
    // the first call didn't mutate shared state that the second call read.
    const groupsARepeat = groupLinesByStyle(cartonALines);
    expect(groupsARepeat[0]?.totalQuantity).toBe(5);
  });

  it('returns an empty array for an empty carton/destination (no lines)', () => {
    expect(groupLinesByStyle([])).toEqual([]);
  });
});

describe('distinctSizeColumns', () => {
  it('dedupes by stable sizeId, keeping the first-seen sizeCode and first-appearance order', () => {
    const lines = [
      makeLine({ sizeId: 'size-b', sizeCode: 'L' }),
      makeLine({ sizeId: 'size-a', sizeCode: 'S' }),
      makeLine({ sizeId: 'size-b', sizeCode: 'L (duplicate entry, should be ignored)' }),
    ];
    expect(distinctSizeColumns(lines)).toEqual([
      { sizeId: 'size-b', sizeCode: 'L' },
      { sizeId: 'size-a', sizeCode: 'S' },
    ]);
  });

  it('does not merge two different sizeIds that happen to share a sizeCode text', () => {
    const lines = [makeLine({ sizeId: 'size-a', sizeCode: 'M' }), makeLine({ sizeId: 'size-b', sizeCode: 'M' })];
    expect(distinctSizeColumns(lines)).toHaveLength(2);
  });
});

function makeFinancialLine(overrides: Partial<FinancialStyleSizeLine> = {}): FinancialStyleSizeLine {
  return {
    id: 'line-1',
    styleId: 'style-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10,
    unitRate: 100,
    defaultRate: 100,
    lineAmount: 1000,
    ...overrides,
  };
}

describe('groupFinancialLinesByStyle (ISS-010 Factory Invoice financial grouping)', () => {
  it('single Style, single Size — one row', () => {
    const groups = groupFinancialLinesByStyle([makeFinancialLine()]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ styleId: 'style-1', totalQuantity: 10, amount: 1000, unitRate: 100, rateOverridden: false });
  });

  it('single Style, multiple Sizes — collapses into one row with a Size breakdown and summed amount', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', sizeId: 'size-a', sizeCode: 'S', sizeLabel: 'Small', quantity: 10, lineAmount: 1000 }),
      makeFinancialLine({ id: 'l2', sizeId: 'size-b', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20, lineAmount: 2000 }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sizeEntries).toEqual([
      { sizeId: 'size-a', sizeCode: 'S', sizeLabel: 'Small', quantity: 10 },
      { sizeId: 'size-b', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 },
    ]);
    expect(groups[0]?.totalQuantity).toBe(30);
    expect(groups[0]?.amount).toBe(3000);
    expect(groups[0]?.sourceLineIds).toEqual(['l1', 'l2']);
  });

  it('multiple Styles — one row each, in first-appearance order', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', styleId: 'style-a', styleNumber: 'ST-A' }),
      makeFinancialLine({ id: 'l2', styleId: 'style-b', styleNumber: 'ST-B' }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    expect(groups.map((g) => g.styleId)).toEqual(['style-a', 'style-b']);
  });

  it('repeated Style+Size from different source allocations (e.g. two destinations) sums into one Size entry, not a second row', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', sizeId: 'size-1', quantity: 10, lineAmount: 1000 }),
      makeFinancialLine({ id: 'l2', sizeId: 'size-1', quantity: 5, lineAmount: 500 }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sizeEntries).toEqual([{ sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 15 }]);
    expect(groups[0]?.amount).toBe(1500);
  });

  it('same Style with different persisted (ACCOUNTANT-overridden) rates stays as separate, distinguishable rows', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', sizeId: 'size-a', unitRate: 100, defaultRate: 100, quantity: 10, lineAmount: 1000 }),
      makeFinancialLine({ id: 'l2', sizeId: 'size-b', unitRate: 120, defaultRate: 100, quantity: 5, lineAmount: 600 }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.unitRate)).toEqual([100, 120]);
    expect(groups[1]?.rateOverridden).toBe(true);
    // Never averaged or merged into a single blended rate/amount.
    expect(groups[0]?.amount).toBe(1000);
    expect(groups[1]?.amount).toBe(600);
  });

  it('does not invent tax-treatment incompatibility that does not exist on this line shape — grouping key is styleId+unitRate only', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', sizeId: 'size-a', unitRate: 100, quantity: 10 }),
      makeFinancialLine({ id: 'l2', sizeId: 'size-b', unitRate: 100, quantity: 5 }),
    ];
    expect(groupFinancialLinesByStyle(lines)).toHaveLength(1);
  });

  it('multiple Styles sharing identical display names remain separate rows (grouped by styleId, not styleName)', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', styleId: 'style-a', styleNumber: 'ST-A', styleName: 'Classic Tee' }),
      makeFinancialLine({ id: 'l2', styleId: 'style-b', styleNumber: 'ST-B', styleName: 'Classic Tee' }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    expect(groups).toHaveLength(2);
  });

  it('grouped quantities and amounts reconcile exactly to the original source lines', () => {
    const lines = [
      makeFinancialLine({ id: 'l1', styleId: 'style-a', sizeId: 'size-a', quantity: 10, lineAmount: 1000 }),
      makeFinancialLine({ id: 'l2', styleId: 'style-a', sizeId: 'size-b', quantity: 20, lineAmount: 2000 }),
      makeFinancialLine({ id: 'l3', styleId: 'style-b', sizeId: 'size-a', quantity: 7, lineAmount: 700 }),
    ];
    const groups = groupFinancialLinesByStyle(lines);
    const totalQuantity = groups.reduce((sum, g) => sum + g.totalQuantity, 0);
    const totalAmount = groups.reduce((sum, g) => sum + g.amount, 0);
    expect(totalQuantity).toBe(lines.reduce((sum, l) => sum + l.quantity, 0));
    expect(totalAmount).toBe(lines.reduce((sum, l) => sum + l.lineAmount, 0));
  });

  it('returns an empty array for no lines', () => {
    expect(groupFinancialLinesByStyle([])).toEqual([]);
  });
});

function makeReceiptLine(overrides: Partial<ReceiptTraceableLine> = {}): ReceiptTraceableLine {
  return {
    saleOrderLineId: 'sol-1',
    styleNumber: 'ST-001',
    styleName: 'Classic Tee',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10,
    ...overrides,
  };
}

describe('groupReceiptLinesByStyle (ISS-080)', () => {
  it('groups one Style with multiple Sizes under a single group, in original order', () => {
    const lines = [
      makeReceiptLine({ saleOrderLineId: 'sol-s', sizeCode: 'S', sizeLabel: 'Small', quantity: 5 }),
      makeReceiptLine({ saleOrderLineId: 'sol-m', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10 }),
      makeReceiptLine({ saleOrderLineId: 'sol-l', sizeCode: 'L', sizeLabel: 'Large', quantity: 8 }),
    ];
    const groups = groupReceiptLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines.map((line) => line.sizeCode)).toEqual(['S', 'M', 'L']);
    expect(groups[0]!.dispatchedSubtotal).toBe(23);
  });

  it('keeps multiple Styles as separate groups, in first-appearance order, never mixing their lines', () => {
    const lines = [
      makeReceiptLine({ saleOrderLineId: 'sol-a1', styleNumber: 'ST-A', styleName: 'Style A', sizeCode: 'M' }),
      makeReceiptLine({ saleOrderLineId: 'sol-b1', styleNumber: 'ST-B', styleName: 'Style B', sizeCode: 'M' }),
      makeReceiptLine({ saleOrderLineId: 'sol-a2', styleNumber: 'ST-A', styleName: 'Style A', sizeCode: 'L' }),
    ];
    const groups = groupReceiptLinesByStyle(lines);
    expect(groups.map((g) => g.styleNumber)).toEqual(['ST-A', 'ST-B']);
    expect(groups[0]!.lines.map((l) => l.saleOrderLineId)).toEqual(['sol-a1', 'sol-a2']);
    expect(groups[1]!.lines.map((l) => l.saleOrderLineId)).toEqual(['sol-b1']);
  });

  it('never merges duplicate Style+Size source lines — each original saleOrderLineId stays its own traceable entry', () => {
    const lines = [
      makeReceiptLine({ saleOrderLineId: 'sol-dup-1', sizeCode: 'M', quantity: 10 }),
      makeReceiptLine({ saleOrderLineId: 'sol-dup-2', sizeCode: 'M', quantity: 6 }),
    ];
    const groups = groupReceiptLinesByStyle(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.lines).toHaveLength(2);
    expect(groups[0]!.lines.map((l) => l.saleOrderLineId)).toEqual(['sol-dup-1', 'sol-dup-2']);
    expect(groups[0]!.dispatchedSubtotal).toBe(16);
  });

  it('reconciles each group dispatchedSubtotal exactly to the sum of its underlying lines', () => {
    const lines = [
      makeReceiptLine({ saleOrderLineId: 'sol-1', styleNumber: 'ST-A', quantity: 4 }),
      makeReceiptLine({ saleOrderLineId: 'sol-2', styleNumber: 'ST-A', quantity: 11 }),
      makeReceiptLine({ saleOrderLineId: 'sol-3', styleNumber: 'ST-B', quantity: 7 }),
    ];
    const groups = groupReceiptLinesByStyle(lines);
    const total = groups.reduce((sum, g) => sum + g.dispatchedSubtotal, 0);
    expect(total).toBe(lines.reduce((sum, l) => sum + l.quantity, 0));
    expect(groups.find((g) => g.styleNumber === 'ST-A')!.dispatchedSubtotal).toBe(15);
  });

  it('returns an empty array for no lines', () => {
    expect(groupReceiptLinesByStyle([])).toEqual([]);
  });
});
