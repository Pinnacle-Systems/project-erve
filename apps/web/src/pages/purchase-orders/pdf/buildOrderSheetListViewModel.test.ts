import { describe, expect, it } from 'vitest';
import type { PurchaseOrder } from '../types.js';
import { buildOrderSheetListViewModel } from './buildOrderSheetListViewModel.js';

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
        seasonSnapshots: [],
        sizes: [],
        totalOrderedQuantity: 500,
      },
    ],
    ...overrides,
  };
}

describe('buildOrderSheetListViewModel', () => {
  it('produces a "Order Sheet" title/subtitle and zero rows for an empty list', () => {
    const vm = buildOrderSheetListViewModel([], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.title).toBe('ORDER SHEET LIST');
    expect(vm.title).not.toContain('PURCHASE ORDER');
    expect(vm.title).not.toContain('PO');
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('maps Distributor, Style, Purchase Mode, dates, quantity and planning state for a single row', () => {
    const vm = buildOrderSheetListViewModel([makeOrder()], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0]).toMatchObject({
      id: 'po-1',
      poNumber: 'EIOS/26-27/0001',
      distributorName: 'Acme Distributors',
      styleNumber: 'STY-0001',
      styleName: 'Basic Tee',
      purchaseMode: 'Outright',
      poDate: '01 Apr 2026',
      requiredDeliveryDate: '01 May 2026',
      totalOrderedQuantity: 500,
      planningState: 'Available for Job Order',
      jobOrderNumber: '',
    });
  });

  it('shows the linked Job Order number for a locked Order Sheet, without an "Approved" label', () => {
    const order = makeOrder({
      jobOrderId: 'jo-1',
      lockedByJobOrder: { id: 'jo-1', jobOrderNumber: 'EIJO/26-27/0001', status: 'IN_PRODUCTION' },
    });
    const vm = buildOrderSheetListViewModel([order], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows[0]?.jobOrderNumber).toBe('EIJO/26-27/0001');
    expect(vm.rows[0]?.planningState).toBe('Included in Job Order');
    expect(vm.rows[0]?.planningState.toLowerCase()).not.toContain('approved');
  });

  it('shows Cancelled planning state and never Fulfilled/Closed/Short Close labels', () => {
    const order = makeOrder({ status: 'CANCELLED' });
    const vm = buildOrderSheetListViewModel([order], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows[0]?.planningState).toBe('Cancelled');
    const allLabels = vm.rows.map((r) => r.planningState).join(' ');
    expect(allLabels).not.toMatch(/fulfilled|closed|short close/i);
  });

  it('preserves row order as given (server order), not re-sorted', () => {
    const orderA = makeOrder({ id: 'po-1', poNumber: 'EIOS/26-27/0002' });
    const orderB = makeOrder({ id: 'po-2', poNumber: 'EIOS/26-27/0001' });
    const vm = buildOrderSheetListViewModel([orderA, orderB], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['po-1', 'po-2']);
  });

  it('renders every declared filter as an active chip value', () => {
    const vm = buildOrderSheetListViewModel(
      [],
      {
        search: 'EIOS',
        planningState: 'INCLUDED_IN_JOB_ORDER',
        distributorName: 'Acme Distributors',
        purchaseMode: 'SALE_RETURN',
        financialYearLabel: '26-27',
      },
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'EIOS' },
      { label: 'Planning State', value: 'Included in Job Order' },
      { label: 'Distributor', value: 'Acme Distributors' },
      { label: 'Purchase Mode', value: 'Sale or Return' },
      { label: 'Financial Year', value: '26-27' },
    ]);
  });

  it('omits unset filters as empty-string values', () => {
    const vm = buildOrderSheetListViewModel([], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.filters.every((f) => f.value === '')).toBe(true);
  });

  it('handles a line-less Order Sheet without throwing (defensive; should not occur)', () => {
    const order = makeOrder({ lines: [] });
    const vm = buildOrderSheetListViewModel([order], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.rows[0]?.styleNumber).toBe('');
    expect(vm.rows[0]?.styleName).toBe('');
  });

  it('does not leak unrelated/internal properties into the printable row', () => {
    const order = { ...makeOrder(), __internalDebugFlag: true, someAuditInternal: 'secret' } as PurchaseOrder;
    const vm = buildOrderSheetListViewModel([order], {}, { generatedAt: '2026-09-12T10:00:00Z' });
    const serialized = JSON.stringify(vm.rows[0]);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
