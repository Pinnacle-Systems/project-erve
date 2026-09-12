import { describe, expect, it } from 'vitest';
import type { PurchaseOrder } from '../types.js';
import { buildOrderSheetDetailViewModel } from './buildOrderSheetDetailViewModel.js';

function makeOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'EIOS/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    financialYear: { id: 'fy1', code: '2026-27' },
    poDate: '2026-04-01T00:00:00.000Z',
    requiredDeliveryDate: '2026-05-01T00:00:00.000Z',
    purchaseMode: 'OUTRIGHT',
    status: 'SUBMITTED',
    jobOrderId: null,
    lockedByJobOrder: null,
    totalOrderedQuantity: 500,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    merchandiser: { id: 'm1', name: 'Merch One', email: 'merch@erve.local' },
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    remarks: null,
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: 'STY-0001',
        styleName: 'Basic Tee',
        lineStatus: 'ACTIVE',
        remarks: null,
        seasonSnapshots: [
          { seasonId: 's1', code: 'SS27', name: 'Spring Summer 27', financialYear: '2026-27', displayName: 'SS27' },
        ],
        sizes: [
          { id: 'sz-1', sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', orderedQuantity: 200, saleOrderedQuantity: 0, dispatchedQuantity: 0, deliveredQuantity: 0, actualSoldQuantity: 0, returnedQuantity: 0, reassignedQuantity: 0 },
          { id: 'sz-2', sizeId: 'size-m', sizeCode: 'M', sizeLabel: 'Medium', orderedQuantity: 0, saleOrderedQuantity: 0, dispatchedQuantity: 0, deliveredQuantity: 0, actualSoldQuantity: 0, returnedQuantity: 0, reassignedQuantity: 0 },
          { id: 'sz-3', sizeId: 'size-l', sizeCode: 'L', sizeLabel: 'Large', orderedQuantity: 300, saleOrderedQuantity: 0, dispatchedQuantity: 0, deliveredQuantity: 0, actualSoldQuantity: 0, returnedQuantity: 0, reassignedQuantity: 0 },
        ],
        totalOrderedQuantity: 500,
      },
    ],
    ...overrides,
  };
}

describe('buildOrderSheetDetailViewModel', () => {
  it('builds identity items for the single Style, Distributor and Purchase Mode', () => {
    const vm = buildOrderSheetDetailViewModel(makeOrder(), { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.title).toBe('ORDER SHEET');
    expect(vm.subtitle).toBe('EIOS/26-27/0001 — Acme Distributors');
    expect(vm.identityItems).toContainEqual({ label: 'Distributor', value: 'Acme Distributors' });
    expect(vm.identityItems).toContainEqual({ label: 'Purchase Mode', value: 'Outright' });
    expect(vm.identityItems).toContainEqual({ label: 'Total Quantity', value: 500 });
  });

  it('preserves zero quantities distinctly from null (size with 0 ordered stays 0)', () => {
    const vm = buildOrderSheetDetailViewModel(makeOrder(), { generatedAt: '2026-09-12T10:00:00Z' });
    const mediumSize = vm.lines[0]?.sizes.find((s) => s.sizeCode === 'M');
    expect(mediumSize?.orderedQuantity).toBe(0);
  });

  it('renders null required delivery date as null (formatted to em dash downstream), not a fabricated date', () => {
    const order = makeOrder({ requiredDeliveryDate: null });
    const vm = buildOrderSheetDetailViewModel(order, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.identityItems).toContainEqual({ label: 'Required Delivery Date', value: null });
  });

  it('shows a locked Order Sheet\'s Job Order without using an "Approved" label', () => {
    const order = makeOrder({
      jobOrderId: 'jo-1',
      lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/26-27/0007', status: 'IN_PRODUCTION' },
    });
    const vm = buildOrderSheetDetailViewModel(order, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.identityItems).toContainEqual({
      label: 'Job Order',
      value: 'EIJO/26-27/0007 (IN_PRODUCTION)',
    });
    const serialized = JSON.stringify(vm.identityItems).toLowerCase();
    expect(serialized).not.toContain('approved');
    expect(serialized).not.toMatch(/fulfilled|closed|short close/);
  });

  it('preserves size order as returned by the API', () => {
    const vm = buildOrderSheetDetailViewModel(makeOrder(), { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.lines[0]?.sizes.map((s) => s.sizeCode)).toEqual(['S', 'M', 'L']);
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const order = { ...makeOrder(), __internalDebugFlag: true, someAuditInternal: 'secret' } as PurchaseOrder;
    const vm = buildOrderSheetDetailViewModel(order, { generatedAt: '2026-09-12T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
