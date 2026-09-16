import { describe, expect, it } from 'vitest';
import type { ErveDispatchView } from '../../types.js';
import { buildErveDispatchDetailViewModel } from './buildErveDispatchDetailViewModel.js';

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
    remarks: 'Handle with care',
    dispatchedBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    dispatchedAt: '2026-06-30T00:00:00.000Z',
    lrUpdatedBy: null,
    lrUpdatedAt: null,
    deliveredBy: null,
    deliveredAt: null,
    deliveryRemarks: null,
    deliveryConfirmationSource: null,
    totalQuantity: 20,
    invoiceHandoffs: [
      {
        invoiceHandoffId: 'ih-1',
        saleOrderLineId: 'sol-1',
        purchaseMode: 'OUTRIGHT',
        styleNumber: 'ST-1',
        styleName: 'Shirt',
        sizeCode: 'M',
        sizeLabel: 'Medium',
        quantity: 20,
        status: 'PENDING_TALLY',
        tallyInvoiceNumber: null,
        tallyInvoiceDate: null,
      },
    ],
    saleOrReturnLines: [],
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildErveDispatchDetailViewModel', () => {
  it('maps identity, delivery ("not yet confirmed"), and Invoice/Tally rows when permitted', () => {
    const dispatch = makeDispatch();
    const vm = buildErveDispatchDetailViewModel(dispatch, { invoiceHandoffs: dispatch.invoiceHandoffs }, { generatedAt: '2026-07-01T10:00:00Z' });

    expect(vm.identityItems).toContainEqual({ label: 'Erve Dispatch Number', value: 'ED/26-27/0001' });
    expect(vm.deliveryItems).toContainEqual({ label: 'Delivery', value: 'Not yet confirmed' });
    expect(vm.invoiceHandoffs).toEqual([
      { invoiceHandoffId: 'ih-1', modeLabel: 'Outright', styleDisplay: 'ST-1 / Medium', quantity: 20, statusLabel: 'Pending Tally', tallyInvoiceNumber: null },
    ]);
  });

  it('represents an excluded Invoice/Tally section as null, never an empty array', () => {
    const dispatch = makeDispatch();
    const vm = buildErveDispatchDetailViewModel(dispatch, { invoiceHandoffs: null }, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.invoiceHandoffs).toBeNull();
  });

  it('shows a legacy-assumed delivery distinctly from a real confirmation', () => {
    const dispatch = makeDispatch({
      status: 'DELIVERED',
      deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT',
    });
    const vm = buildErveDispatchDetailViewModel(dispatch, { invoiceHandoffs: [] }, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.deliveryItems).toContainEqual({ label: 'Delivery', value: 'Assumed full receipt (legacy — not actually confirmed)' });
  });

  it('shows a real confirmed delivery with the confirming user and timestamp', () => {
    const dispatch = makeDispatch({
      status: 'DELIVERED',
      deliveryConfirmationSource: 'USER_CONFIRMED',
      deliveredBy: { id: 'u2', name: 'Warehouse User', email: 'wh@erve.local' },
      deliveredAt: '2026-07-05T12:00:00.000Z',
    });
    const vm = buildErveDispatchDetailViewModel(dispatch, { invoiceHandoffs: [] }, { generatedAt: '2026-07-06T10:00:00Z' });
    expect(vm.deliveryItems[0]?.value).toContain('Warehouse User');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const dispatch = { ...makeDispatch(), internalId: 'secret', rawSnapshotJson: '{}' } as ErveDispatchView;
    const vm = buildErveDispatchDetailViewModel(dispatch, { invoiceHandoffs: [] }, { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('rawSnapshotJson');
  });
});
