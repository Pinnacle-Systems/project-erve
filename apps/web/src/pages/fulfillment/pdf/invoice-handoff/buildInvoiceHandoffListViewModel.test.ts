import { describe, expect, it } from 'vitest';
import type { InvoiceHandoffView } from '../../types.js';
import { buildInvoiceHandoffListViewModel } from './buildInvoiceHandoffListViewModel.js';

function makeHandoff(overrides: Partial<InvoiceHandoffView> = {}): InvoiceHandoffView {
  return {
    id: 'ih-1',
    erveDispatch: { id: 'ed1', erveDispatchNumber: 'ED/26-27/0001', dispatchDate: '2026-06-30T00:00:00.000Z' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'SALE_RETURN',
    saleOrderLineId: 'sol1',
    style: { styleNumber: 'ST-1', styleName: 'Shirt' },
    size: { sizeCode: 'M', sizeLabel: 'Medium' },
    quantity: 20,
    status: 'PENDING_TALLY',
    tallyInvoiceNumber: null,
    tallyInvoiceDate: null,
    tallyVoucherReference: null,
    remarks: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildInvoiceHandoffListViewModel', () => {
  it('maps rows with mode/style/status text', () => {
    const vm = buildInvoiceHandoffListViewModel([makeHandoff()], { status: 'PENDING_TALLY' }, { generatedAt: '2026-07-01T10:00:00Z' });

    expect(vm.totalCount).toBe(1);
    expect(vm.rows[0]).toEqual({
      id: 'ih-1',
      modeLabel: 'Sale-or-Return',
      erveDispatchNumber: 'ED/26-27/0001',
      distributorName: 'Acme Distributors',
      styleDisplay: 'ST-1 / Medium',
      quantity: 20,
      statusLabel: 'Pending Tally',
      tallyInvoiceNumber: null,
      tallyInvoiceDate: '',
    });
  });

  it('shows Invoiced status and the Tally reference once recorded', () => {
    const vm = buildInvoiceHandoffListViewModel(
      [makeHandoff({ status: 'INVOICED', tallyInvoiceNumber: 'TALLY-001', tallyInvoiceDate: '2026-07-05T00:00:00.000Z' })],
      { status: 'INVOICED' },
      { generatedAt: '2026-07-01T10:00:00Z' },
    );
    expect(vm.rows[0]?.statusLabel).toBe('Invoiced');
    expect(vm.rows[0]?.tallyInvoiceNumber).toBe('TALLY-001');
    expect(vm.rows[0]?.tallyInvoiceDate).toBe('05 Jul 2026');
  });

  it('never labels this list a Tax Invoice or GST Invoice', () => {
    const vm = buildInvoiceHandoffListViewModel([makeHandoff()], {}, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.title).not.toMatch(/tax invoice|gst invoice/i);
    expect(vm.subtitle).not.toMatch(/tax invoice|gst invoice/i);
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const handoff = { ...makeHandoff(), internalId: 'secret', debugValue: 1 } as InvoiceHandoffView;
    const vm = buildInvoiceHandoffListViewModel([handoff], {}, { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('debugValue');
  });
});
