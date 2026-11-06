import { describe, expect, it } from 'vitest';
import { HttpError } from '../../errors/http-error.js';
import { buildReceiptPlan, computeReceiptPayloadDigest, type ReceiptSourceLine } from './distributor-receipt-plan.js';

const single: ReceiptSourceLine[] = [
  { saleOrderLineId: 'L1', styleId: 'S1', sizeId: 'M', dispatchedQuantity: 10 },
  { saleOrderLineId: 'L2', styleId: 'S1', sizeId: 'L', dispatchedQuantity: 6 },
];
// Style S1 / Size M supplied by two Sale Order lines (e.g. two Dispatch Orders).
const multi: ReceiptSourceLine[] = [
  { saleOrderLineId: 'A', styleId: 'S1', sizeId: 'M', dispatchedQuantity: 60 },
  { saleOrderLineId: 'B', styleId: 'S1', sizeId: 'M', dispatchedQuantity: 40 },
  { saleOrderLineId: 'C', styleId: 'S2', sizeId: 'M', dispatchedQuantity: 5 },
];

const rejects = (fn: () => unknown, message: RegExp) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected a 400 HttpError');
};

describe('buildReceiptPlan', () => {
  it('plans a full receipt with no shortage', () => {
    const plan = buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 10 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]);
    expect(plan).toMatchObject({ totalDispatchedQuantity: 16, totalReceivedQuantity: 16, hasShortage: false });
    expect(plan.lines).toEqual([
      { saleOrderLineId: 'L1', dispatchedQuantity: 10, receivedQuantity: 10 },
      { saleOrderLineId: 'L2', dispatchedQuantity: 6, receivedQuantity: 6 },
    ]);
  });

  it('allows a zero line among positive lines and an all-zero receipt', () => {
    const some = buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 0 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]);
    expect(some).toMatchObject({ totalReceivedQuantity: 6, hasShortage: true });
    const none = buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 0 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 0 },
    ]);
    expect(none).toMatchObject({ totalReceivedQuantity: 0, hasShortage: true });
  });

  it('rejects over-receipt, negative and fractional quantities', () => {
    rejects(() => buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 11 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]), /cannot exceed the dispatched/);
    rejects(() => buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: -1 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]), /whole number/);
    rejects(() => buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 1.5 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]), /whole number/);
  });

  it('requires complete coverage with no duplicates or unknown Style / Size', () => {
    rejects(() => buildReceiptPlan(single, [{ styleId: 'S1', sizeId: 'M', receivedQuantity: 10 }]), /cover every/);
    rejects(() => buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 10 },
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 10 },
      { styleId: 'S1', sizeId: 'L', receivedQuantity: 6 },
    ]), /Duplicate/);
    rejects(() => buildReceiptPlan(single, [
      { styleId: 'S1', sizeId: 'M', receivedQuantity: 10 },
      { styleId: 'S9', sizeId: 'L', receivedQuantity: 6 },
    ]), /does not match/);
  });

  describe('Style x Size backed by several Sale Order lines', () => {
    const others = { styleId: 'S2', sizeId: 'M', receivedQuantity: 5 };

    it('allocates a full receipt to each line automatically', () => {
      const plan = buildReceiptPlan(multi, [{ styleId: 'S1', sizeId: 'M', receivedQuantity: 100 }, others]);
      expect(plan.lines.map((l) => [l.saleOrderLineId, l.receivedQuantity])).toEqual([['A', 60], ['B', 40], ['C', 5]]);
    });

    it('allocates a zero receipt to each line automatically', () => {
      const plan = buildReceiptPlan(multi, [{ styleId: 'S1', sizeId: 'M', receivedQuantity: 0 }, others]);
      expect(plan.lines.map((l) => [l.saleOrderLineId, l.receivedQuantity])).toEqual([['A', 0], ['B', 0], ['C', 5]]);
    });

    it('never silently distributes an ambiguous partial receipt', () => {
      rejects(() => buildReceiptPlan(multi, [{ styleId: 'S1', sizeId: 'M', receivedQuantity: 90 }, others]), /must be allocated/);
    });

    it('accepts an exact explicit allocation and preserves it per line', () => {
      const plan = buildReceiptPlan(multi, [
        {
          styleId: 'S1', sizeId: 'M', receivedQuantity: 90,
          allocations: [{ saleOrderLineId: 'B', receivedQuantity: 40 }, { saleOrderLineId: 'A', receivedQuantity: 50 }],
        },
        others,
      ]);
      expect(plan.lines.map((l) => [l.saleOrderLineId, l.receivedQuantity])).toEqual([['A', 50], ['B', 40], ['C', 5]]);
      expect(plan).toMatchObject({ totalDispatchedQuantity: 105, totalReceivedQuantity: 95, hasShortage: true });
    });

    it('rejects allocations that do not total the entry, exceed a line ceiling, or mis-cover the lines', () => {
      const base = { styleId: 'S1', sizeId: 'M', receivedQuantity: 90 };
      rejects(() => buildReceiptPlan(multi, [
        { ...base, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 50 }, { saleOrderLineId: 'B', receivedQuantity: 30 }] }, others,
      ]), /total 80 but 90/);
      rejects(() => buildReceiptPlan(multi, [
        { ...base, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 62 }, { saleOrderLineId: 'B', receivedQuantity: 28 }] }, others,
      ]), /cannot exceed the dispatched quantity of its source line/);
      rejects(() => buildReceiptPlan(multi, [
        { ...base, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 90 }] }, others,
      ]), /exactly the source lines/);
      rejects(() => buildReceiptPlan(multi, [
        { ...base, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 45 }, { saleOrderLineId: 'A', receivedQuantity: 45 }] }, others,
      ]), /Duplicate source-line/);
      rejects(() => buildReceiptPlan(multi, [
        { ...base, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 50 }, { saleOrderLineId: 'Z', receivedQuantity: 40 }] }, others,
      ]), /exactly the source lines/);
    });

    it('rejects supplied allocations that contradict a forced (full or zero) group', () => {
      rejects(() => buildReceiptPlan(multi, [
        {
          styleId: 'S1', sizeId: 'M', receivedQuantity: 100,
          allocations: [{ saleOrderLineId: 'A', receivedQuantity: 50 }, { saleOrderLineId: 'B', receivedQuantity: 50 }],
        }, others,
      ]), /does not match|cannot exceed/);
      const ok = buildReceiptPlan(multi, [
        {
          styleId: 'S1', sizeId: 'M', receivedQuantity: 100,
          allocations: [{ saleOrderLineId: 'A', receivedQuantity: 60 }, { saleOrderLineId: 'B', receivedQuantity: 40 }],
        }, others,
      ]);
      expect(ok.totalReceivedQuantity).toBe(105);
    });
  });
});

describe('computeReceiptPayloadDigest', () => {
  const groups = [
    { styleId: 'S1', sizeId: 'M', receivedQuantity: 90, allocations: [{ saleOrderLineId: 'B', receivedQuantity: 40 }, { saleOrderLineId: 'A', receivedQuantity: 50 }] },
    { styleId: 'S2', sizeId: 'M', receivedQuantity: 5 },
  ];

  it('is stable across ordering, whitespace and empty allocation lists', () => {
    const reordered = [
      { styleId: 'S2', sizeId: 'M', receivedQuantity: 5, allocations: [] },
      { ...groups[0]!, allocations: [...groups[0]!.allocations!].reverse() },
    ];
    expect(computeReceiptPayloadDigest({ remarks: '  short  ', groups })).toBe(
      computeReceiptPayloadDigest({ remarks: 'short', groups: reordered }),
    );
    expect(computeReceiptPayloadDigest({ remarks: '', groups })).toBe(computeReceiptPayloadDigest({ remarks: null, groups }));
  });

  it('changes when any business content changes', () => {
    const base = computeReceiptPayloadDigest({ remarks: 'x', groups });
    expect(computeReceiptPayloadDigest({ remarks: 'y', groups })).not.toBe(base);
    expect(computeReceiptPayloadDigest({ remarks: 'x', groups: [{ ...groups[1]!, receivedQuantity: 4 }, groups[0]!] })).not.toBe(base);
    expect(computeReceiptPayloadDigest({
      remarks: 'x',
      groups: [{ ...groups[0]!, allocations: [{ saleOrderLineId: 'A', receivedQuantity: 49 }, { saleOrderLineId: 'B', receivedQuantity: 41 }] }, groups[1]!],
    })).not.toBe(base);
  });
});
