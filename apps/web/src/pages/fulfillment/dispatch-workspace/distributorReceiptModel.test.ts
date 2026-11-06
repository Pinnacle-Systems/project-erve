import { describe, expect, it } from 'vitest';
import type { ErveDispatchQuantityLine } from '@erve/types';
import {
  buildReceiptEntryGroups,
  buildReceiptRequest,
  needsAllocation,
  validateReceiptEntries,
} from './distributorReceiptModel.js';

const line = (overrides: Partial<ErveDispatchQuantityLine>): ErveDispatchQuantityLine => ({
  saleOrderLineId: 'l',
  styleId: 'st',
  styleNumber: 'ST-1',
  styleName: 'Tee',
  primaryImage: null,
  sizeId: 'm',
  sizeCode: 'M',
  sizeLabel: 'Medium',
  sizeSortOrder: 1,
  quantity: 10,
  ...overrides,
});

// Style ST-1 / M is supplied by two Sale Order lines of different purchase mode.
const lines = [
  line({ saleOrderLineId: 'b', quantity: 40, saleOrderNumber: 'EISO/2', purchaseMode: 'OUTRIGHT' }),
  line({ saleOrderLineId: 'a', quantity: 60, saleOrderNumber: 'EISO/1', purchaseMode: 'SALE_RETURN' }),
  line({ saleOrderLineId: 'c', sizeId: 'l', sizeCode: 'L', sizeLabel: 'Large', sizeSortOrder: 2, quantity: 5 }),
];

describe('distributor receipt model', () => {
  it('groups by Style x Size, summing source lines and ordering sources by order number', () => {
    const groups = buildReceiptEntryGroups(lines);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: 'st::m', dispatchedQuantity: 100 });
    expect(groups[0]!.sources.map((s) => [s.saleOrderLineId, s.purchaseMode])).toEqual([
      ['a', 'SALE_RETURN'],
      ['b', 'OUTRIGHT'],
    ]);
    expect(groups[1]).toMatchObject({ key: 'st::l', dispatchedQuantity: 5 });
  });

  it('needs source allocation only for a partial receipt of a multi-line group', () => {
    const [multi, single] = buildReceiptEntryGroups(lines);
    expect(needsAllocation(multi!, 90)).toBe(true);
    expect(needsAllocation(multi!, 100)).toBe(false);
    expect(needsAllocation(multi!, 0)).toBe(false);
    expect(needsAllocation(multi!, null)).toBe(false);
    expect(needsAllocation(single!, 3)).toBe(false);
  });

  it('is incomplete until every cell is entered, and reports shortage only when complete', () => {
    const groups = buildReceiptEntryGroups(lines);
    expect(validateReceiptEntries(groups, { 'st::m': 100 }, {})).toMatchObject({ allEntered: false, entriesValid: false, hasShortage: false });
    const done = validateReceiptEntries(groups, { 'st::m': 100, 'st::l': 0 }, {});
    expect(done).toMatchObject({ allEntered: true, entriesValid: true, hasShortage: true, totalShortage: 5, totalReceived: 100 });
  });

  it('rejects over-receipt and requires an exact allocation for an ambiguous partial group', () => {
    const groups = buildReceiptEntryGroups(lines);
    expect(validateReceiptEntries(groups, { 'st::m': 101, 'st::l': 5 }, {}).groupErrors['st::m']).toMatch(/Cannot exceed/);
    const entries = { 'st::m': 90, 'st::l': 5 };
    expect(validateReceiptEntries(groups, entries, {}).groupErrors['st::m']).toMatch(/Allocate/);
    expect(validateReceiptEntries(groups, entries, { 'st::m': { a: '50', b: '30' } }).groupErrors['st::m']).toMatch(/total 80/);
    expect(validateReceiptEntries(groups, entries, { 'st::m': { a: '61', b: '29' } }).groupErrors['st::m']).toMatch(/cannot exceed its dispatched 60/);
    expect(validateReceiptEntries(groups, entries, { 'st::m': { a: '50', b: '40' } }).entriesValid).toBe(true);
  });

  it('builds a strict request: allocations only for ambiguous groups, remarks trimmed', () => {
    const groups = buildReceiptEntryGroups(lines);
    const request = buildReceiptRequest(
      groups,
      { 'st::m': 90, 'st::l': 5 },
      { 'st::m': { a: '50', b: '40' } },
      { expectedVersion: 7, remarks: '  10 short  ' },
    );
    expect(request).toEqual({
      expectedVersion: 7,
      acknowledged: true,
      remarks: '10 short',
      groups: [
        { styleId: 'st', sizeId: 'm', receivedQuantity: 90, allocations: [{ saleOrderLineId: 'a', receivedQuantity: 50 }, { saleOrderLineId: 'b', receivedQuantity: 40 }] },
        { styleId: 'st', sizeId: 'l', receivedQuantity: 5 },
      ],
    });
    expect(buildReceiptRequest(groups, { 'st::m': 100, 'st::l': 5 }, {}, { expectedVersion: 1, remarks: ' ' }).remarks).toBeNull();
  });
});
