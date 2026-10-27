import { describe, expect, it } from 'vitest';
import type { DispatchOrderStyleOption } from './DispatchOrderStyleField.js';
import { computeDraftStyleAvailability } from './dispatch-order-draft-stock.js';

const style: DispatchOrderStyleOption = {
  styleId: 'style-1',
  styleNumber: 'SS26-14026001',
  styleName: 'Classic Tee',
  primaryImage: null,
  sizes: ['4Y', '6Y', '8Y', '10Y', '12Y', '14Y'].map((code, index) => ({
    sizeId: `size-${index}`,
    sizeCode: code,
    sizeLabel: code,
    sizeSortOrder: index,
    availableQuantity: 8,
  })),
};

describe('ISS-094/ISS-095 pooled draft availability', () => {
  it('reduces one shared pool as successive destinations allocate 6, 12 and 48', () => {
    const first = computeDraftStyleAvailability(style, [6]);
    expect(first.sizes.map((size) => size.remaining)).toEqual([7, 7, 7, 7, 7, 7]);
    const second = computeDraftStyleAvailability(style, [6, 12]);
    expect(second.sizes.map((size) => size.remaining)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(second.totalShortfall).toBe(0);

    const third = computeDraftStyleAvailability(style, [6, 12, 48]);
    expect(third.totalRequested).toBe(66);
    expect(third.usableAvailable).toBe(48);
    expect(third.totalShortfall).toBe(18);
    expect(third.sizes.map((size) => size.shortfall)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(third.sizes.map((size) => size.remaining)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('restores remaining quantities when an unsaved allocation is edited or removed', () => {
    expect(computeDraftStyleAvailability(style, [6, 12]).sizes[0]?.remaining).toBe(5);
    expect(computeDraftStyleAvailability(style, [6, 6]).sizes[0]?.remaining).toBe(6);
    expect(computeDraftStyleAvailability(style, [6]).sizes[0]?.remaining).toBe(7);
    expect(computeDraftStyleAvailability(style, []).sizes[0]?.remaining).toBe(8);
  });

  it('does not silently drop zero-stock configured Sizes from shortage calculation', () => {
    const zeroStock = { ...style, sizes: style.sizes.map((size, index) => ({ ...size, availableQuantity: index === 0 ? 0 : 8 })) };
    const result = computeDraftStyleAvailability(zeroStock, [6]);
    expect(result.totalShortfall).toBe(1);
    expect(result.sizes[0]).toMatchObject({ sizeCode: '4Y', available: 0, requested: 1, shortfall: 1 });
  });

  it('does not pretend an indivisible total or an empty draft has a valid per-Size allocation', () => {
    const result = computeDraftStyleAvailability(style, [7, null, 6]);
    expect(result.totalRequested).toBe(6);
    expect(result.sizes.every((size) => size.requested === 1)).toBe(true);
  });

  it('handles independently loaded Factory pools and does not mutate source quantities', () => {
    const alternate = { ...style, sizes: style.sizes.map((size) => ({ ...size, availableQuantity: 2 })) };
    expect(computeDraftStyleAvailability(alternate, [6]).sizes[0]?.remaining).toBe(1);
    expect(computeDraftStyleAvailability(style, [6]).sizes[0]?.remaining).toBe(7);
    expect(style.sizes[0]?.availableQuantity).toBe(8);
  });
});
