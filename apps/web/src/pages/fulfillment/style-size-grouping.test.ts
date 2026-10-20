import { describe, expect, it } from 'vitest';
import { distinctSizeColumns, groupLinesByStyle, type StyleSizeQuantityLine } from './style-size-grouping.js';

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
