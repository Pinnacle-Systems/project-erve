import { describe, expect, it } from 'vitest';
import { compareReconciliationLine } from './reconciliation-comparison.js';

describe('source-line reconciliation', () => {
  it('preserves missing evidence separately from explicit zero', () => {
    expect(compareReconciliationLine(20, null, null)).toEqual({
      difference: null,
      differs: false,
      shortageQuantity: null,
    });
    expect(compareReconciliationLine(20, 0, null)).toEqual({
      difference: null,
      differs: true,
      shortageQuantity: 20,
    });
    expect(compareReconciliationLine(20, 0, 0)).toEqual({
      difference: 0,
      differs: false,
      shortageQuantity: 20,
    });
  });
  it('does not cancel opposite differences in the same Style × Size', () => {
    const lines = [compareReconciliationLine(60, 50, 40), compareReconciliationLine(40, 20, 30)];
    expect(lines.reduce((sum, l) => sum + l.difference!, 0)).toBe(0);
    expect(lines.some((l) => l.differs)).toBe(true);
    expect(lines.map((l) => l.shortageQuantity)).toEqual([10, 20]);
  });
  it('identifies full matching and partial differing receipt', () => {
    expect(compareReconciliationLine(100, 100, 100).differs).toBe(false);
    expect(compareReconciliationLine(100, 70, 100)).toEqual({
      difference: -30,
      differs: true,
      shortageQuantity: 30,
    });
  });
});
