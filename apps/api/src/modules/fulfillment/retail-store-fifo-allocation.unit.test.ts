import { describe, expect, it } from 'vitest';
import {
  allocateFifo,
  classifyCandidate,
  istDateOf,
  partitionCandidates,
  type FifoCandidate,
} from './retail-store-fifo-allocation.js';

const candidate = (over: Partial<FifoCandidate> & { id: string }): FifoCandidate => ({
  erveDispatchId: over.id,
  erveDispatchNumber: `EID-${over.id}`,
  saleOrderLineId: `sol-${over.id}`,
  purchaseMode: 'SALE_RETURN',
  dispatchStatus: 'DELIVERED',
  deliveredAt: new Date('2026-10-01T06:00:00Z'),
  confirmationSource: 'DISTRIBUTOR_CONFIRMED',
  ...over,
});

describe('FIFO allocation rules', () => {
  it('uses the India calendar date of the receipt instant', () => {
    expect(istDateOf(new Date('2026-10-01T18:29:59Z'))).toBe('2026-10-01');
    expect(istDateOf(new Date('2026-10-01T18:30:00Z'))).toBe('2026-10-02');
  });

  it('classifies legacy, Outright and later-received candidates and never assumes a date', () => {
    const date = '2026-10-10';
    expect(classifyCandidate(candidate({ id: 'a' }), date)).toBeNull();
    expect(classifyCandidate(candidate({ id: 'a', purchaseMode: 'OUTRIGHT' }), date)).toBe('OUTRIGHT');
    expect(classifyCandidate(candidate({ id: 'a', confirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT', deliveredAt: null }), date)).toBe('UNVERIFIED_RECEIPT');
    // Even a legacy row that carries a timestamp is not verified evidence.
    expect(classifyCandidate(candidate({ id: 'a', confirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' }), date)).toBe('UNVERIFIED_RECEIPT');
    expect(classifyCandidate(candidate({ id: 'a', deliveredAt: null }), date)).toBe('UNVERIFIED_RECEIPT');
    expect(classifyCandidate(candidate({ id: 'a', confirmationSource: null }), date)).toBe('UNVERIFIED_RECEIPT');
    expect(classifyCandidate(candidate({ id: 'a', dispatchStatus: 'DISPATCHED' }), date)).toBe('UNVERIFIED_RECEIPT');
    expect(classifyCandidate(candidate({ id: 'a', deliveredAt: new Date('2026-10-10T10:00:00Z') }), date)).toBeNull();
    expect(classifyCandidate(candidate({ id: 'a', deliveredAt: new Date('2026-10-10T19:00:00Z') }), date)).toBe('RECEIVED_AFTER_DATE');
  });

  it('orders oldest receipt first with deterministic tie-breaks', () => {
    const same = new Date('2026-10-02T06:00:00Z');
    const { eligible } = partitionCandidates(
      [
        candidate({ id: 'z', deliveredAt: new Date('2026-10-05T06:00:00Z') }),
        candidate({ id: 'b', deliveredAt: same }),
        candidate({ id: 'a', deliveredAt: same }),
        candidate({ id: 'old', deliveredAt: new Date('2026-09-01T06:00:00Z') }),
      ],
      '2026-10-31',
    );
    expect(eligible.map((c) => c.erveDispatchId)).toEqual(['old', 'a', 'b', 'z']);
  });

  it('splits a quantity across positions and reports any shortfall', () => {
    const a = candidate({ id: 'a' });
    const b = candidate({ id: 'b' });
    const split = allocateFifo([{ candidate: a, available: 60 }, { candidate: b, available: 40 }], 75);
    expect(split.allocations.map((x) => [x.candidate.erveDispatchId, x.quantity])).toEqual([['a', 60], ['b', 15]]);
    expect(split.shortfall).toBe(0);

    const skip = allocateFifo([{ candidate: a, available: 0 }, { candidate: b, available: -3 }], 5);
    expect(skip.allocations).toEqual([]);
    expect(skip.shortfall).toBe(5);
    expect(skip.totalAvailable).toBe(0);

    const short = allocateFifo([{ candidate: a, available: 10 }, { candidate: b, available: 5 }], 20);
    expect(short.shortfall).toBe(5);
    expect(short.totalAvailable).toBe(15);
  });
});
