import { describe, expect, it } from 'vitest';
import type { SaleOrder } from '../../../sale-orders/types.js';
import { buildDispatchOrderListViewModel } from './buildDispatchOrderListViewModel.js';

function makeSaleOrder(overrides: Partial<SaleOrder> = {}): SaleOrder {
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'd1', code: 'D1', name: 'Acme Distributors', purchaseMode: 'OUTRIGHT' }],
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    financialYear: { id: 'fy1', code: '2026-27' },
    soDate: '2026-06-30T00:00:00.000Z',
    status: 'ACTIVE',
    destinationCount: 1,
    totalQuantity: 100,
    createdAt: '2026-06-30T00:00:00.000Z',
    isLocked: false,
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    remarks: null,
    distributorGroups: [],
    lines: [],
    fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 100, totalFactoryPackedQuantity: 0 },
    ...overrides,
  };
}

describe('buildDispatchOrderListViewModel', () => {
  it('produces a "Dispatch Order List" title and zero rows for an empty list', () => {
    const vm = buildDispatchOrderListViewModel([], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.title).toBe('DISPATCH ORDER LIST');
    expect(vm.rows).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });

  it('maps identity, Factory, Date, FY, quantities and state for a single-Distributor row', () => {
    const vm = buildDispatchOrderListViewModel([makeSaleOrder()], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows[0]).toMatchObject({
      id: 'so-1',
      saleOrderNumber: 'EISO/26-27/0001',
      distributorsDisplay: 'Acme Distributors',
      factoryName: 'Acme Factory',
      soDate: '30 Jun 2026',
      financialYearCode: '26-27',
      destinationCount: 1,
      totalQuantity: 100,
      stateLabel: 'Ready for Factory',
    });
  });

  it('shows "Factory Dispatched" once the Dispatch Order is locked', () => {
    const vm = buildDispatchOrderListViewModel([makeSaleOrder({ isLocked: true })], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows[0]?.stateLabel).toBe('Factory Dispatched');
  });

  it('truncates 3+ same-mode Distributors as "A, B +N" matching the on-screen list', () => {
    const so = makeSaleOrder({
      distributors: [
        { id: 'd1', code: 'D1', name: 'Acme', purchaseMode: 'OUTRIGHT' },
        { id: 'd2', code: 'D2', name: 'Beta', purchaseMode: 'OUTRIGHT' },
        { id: 'd3', code: 'D3', name: 'Gamma', purchaseMode: 'OUTRIGHT' },
      ],
    });
    const vm = buildDispatchOrderListViewModel([so], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows[0]?.distributorsDisplay).toBe('Acme, Beta +1');
  });

  it('never flattens a mixed OUTRIGHT/SALE_RETURN Dispatch Order into one undifferentiated value', () => {
    const so = makeSaleOrder({
      distributors: [
        { id: 'd1', code: 'D1', name: 'Acme', purchaseMode: 'OUTRIGHT' },
        { id: 'd2', code: 'D2', name: 'Beta', purchaseMode: 'SALE_RETURN' },
      ],
    });
    const vm = buildDispatchOrderListViewModel([so], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows[0]?.distributorsDisplay).toBe('Acme (Outright), Beta (Sale/Return)');
  });

  it('preserves row order as given (server order), not re-sorted', () => {
    const soA = makeSaleOrder({ id: 'so-1' });
    const soB = makeSaleOrder({ id: 'so-2' });
    const vm = buildDispatchOrderListViewModel([soA, soB], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.rows.map((r) => r.id)).toEqual(['so-1', 'so-2']);
  });

  it('renders every declared filter as an active chip value', () => {
    const vm = buildDispatchOrderListViewModel(
      [],
      { search: 'EISO', distributorName: 'Acme Distributors', factoryName: 'Acme Factory' },
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.filters).toEqual([
      { label: 'Search', value: 'EISO' },
      { label: 'Distributor', value: 'Acme Distributors' },
      { label: 'Factory', value: 'Acme Factory' },
    ]);
  });

  it('does not leak unrelated/internal properties into the printable row', () => {
    const so = { ...makeSaleOrder(), __internalDebugFlag: true, someAuditInternal: 'secret' } as SaleOrder;
    const vm = buildDispatchOrderListViewModel([so], {}, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm.rows[0]);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
