import { describe, expect, it } from 'vitest';
import { selectedCartonLines } from './CartonQuantityPicker.js';
import type { PackingListLineView } from './types.js';

const lines: PackingListLineView[] = [{
  saleOrderLineId: 'line-m', styleId: 'style', styleNumber: 'ST-001', styleName: 'Tee', primaryImage: null,
  sizeId: 'm', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 12, packedQuantity: 8,
}, {
  saleOrderLineId: 'line-l', styleId: 'style', styleNumber: 'ST-001', styleName: 'Tee', primaryImage: null,
  sizeId: 'l', sizeCode: 'L', sizeLabel: 'Large', requiredQuantity: 10, packedQuantity: 10,
}];

describe('carton desired-state quantity validation', () => {
  it('omits blank and zero cells and requires at least one positive quantity', () => {
    expect(selectedCartonLines(lines, { 'line-m': null, 'line-l': 0 })).toBeNull();
    expect(selectedCartonLines(lines, { 'line-m': 4, 'line-l': 0 })).toEqual([{ saleOrderLineId: 'line-m', quantity: 4 }]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5])('rejects invalid or over-capacity quantity %s', (quantity) => {
    expect(selectedCartonLines(lines, { 'line-m': quantity })).toBeNull();
  });

  it('rejects a stale positive selection even when another valid cell remains', () => {
    expect(selectedCartonLines(lines, { 'line-m': 2, stale: 1 })).toBeNull();
  });

  it('uses only the original edited carton contribution to permit replacement', () => {
    expect(selectedCartonLines(lines, { 'line-m': 7 }, { 'line-m': 3 })).toEqual([{ saleOrderLineId: 'line-m', quantity: 7 }]);
    expect(selectedCartonLines(lines, { 'line-m': 8 }, { 'line-m': 3 })).toBeNull();
    expect(selectedCartonLines(lines, { 'line-l': 2 }, { 'line-m': 3 })).toBeNull();
  });
});
