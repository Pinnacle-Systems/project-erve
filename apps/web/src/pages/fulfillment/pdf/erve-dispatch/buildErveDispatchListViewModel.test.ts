import { describe, expect, it } from 'vitest';
import type { ErveDispatchView } from '../../types.js';
import { buildErveDispatchListViewModel } from './buildErveDispatchListViewModel.js';

function makeDispatch(overrides: Partial<ErveDispatchView> = {}): ErveDispatchView {
  return {
    id: 'ed-1',
    erveDispatchNumber: 'ED/26-27/0001',
    ervePackingList: { id: 'epl-1', ervePackingListNumber: 'EIPL/26-27/0001' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    status: 'DISPATCHED',
    dispatchDate: '2026-06-30T00:00:00.000Z',
    transporter: 'Blue Dart',
    vehicleNumber: 'MH01AB1234',
    lrNumber: 'LR-001',
    remarks: null,
    dispatchedBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    dispatchedAt: '2026-06-30T00:00:00.000Z',
    lrUpdatedBy: null,
    lrUpdatedAt: null,
    deliveredBy: null,
    deliveredAt: null,
    deliveryRemarks: null,
    deliveryConfirmationSource: null,
    totalQuantity: 20,
    invoiceHandoffs: [],
    saleOrReturnLines: [],
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildErveDispatchListViewModel', () => {
  it('maps rows with the resolved EIPL/distributor/status text', () => {
    const vm = buildErveDispatchListViewModel([makeDispatch()], { generatedAt: '2026-07-01T10:00:00Z', generatedBy: 'Test Admin' });

    expect(vm.totalCount).toBe(1);
    expect(vm.rows[0]).toEqual({
      id: 'ed-1',
      erveDispatchNumber: 'ED/26-27/0001',
      ervePackingListNumber: 'EIPL/26-27/0001',
      distributorName: 'Acme Distributors',
      saleOrderNumber: 'EISO/26-27/0001',
      dispatchDate: '30 Jun 2026',
      statusLabel: 'Dispatched',
      deliveredAt: '',
      transporter: 'Blue Dart',
      lrNumber: 'LR-001',
      totalQuantity: 20,
    });
  });

  it('shows "Multiple" when a Dispatch consolidates several Dispatch Orders', () => {
    const vm = buildErveDispatchListViewModel([makeDispatch({ saleOrder: null })], { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.rows[0]?.saleOrderNumber).toBe('Multiple');
  });

  it('shows the DELIVERED status and delivered date once confirmed', () => {
    const vm = buildErveDispatchListViewModel(
      [makeDispatch({ status: 'DELIVERED', deliveredAt: '2026-07-05T00:00:00.000Z' })],
      { generatedAt: '2026-07-01T10:00:00Z' },
    );
    expect(vm.rows[0]?.statusLabel).toBe('Delivered');
    expect(vm.rows[0]?.deliveredAt).toBe('05 Jul 2026');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const dispatch = { ...makeDispatch(), internalId: 'secret', debugValue: 42 } as ErveDispatchView;
    const vm = buildErveDispatchListViewModel([dispatch], { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('debugValue');
  });
});
