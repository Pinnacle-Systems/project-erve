import { describe, expect, it } from 'vitest';
import type { InvoiceHandoffView } from '../../types.js';
import { buildInvoiceHandoffDetailViewModel } from './buildInvoiceHandoffDetailViewModel.js';

function makeHandoff(overrides: Partial<InvoiceHandoffView> = {}): InvoiceHandoffView {
  return {
    id: 'ih-1',
    erveDispatch: { id: 'ed1', erveDispatchNumber: 'ED/26-27/0001', dispatchDate: '2026-06-30T00:00:00.000Z' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'OUTRIGHT',
    saleOrderLineId: 'sol1',
    style: { styleNumber: 'ST-1', styleName: 'Shirt' },
    size: { sizeCode: 'M', sizeLabel: 'Medium' },
    quantity: 20,
    status: 'INVOICED',
    tallyInvoiceNumber: 'TALLY-001',
    tallyInvoiceDate: '2026-07-05T00:00:00.000Z',
    tallyVoucherReference: 'VCH-001',
    remarks: 'Recorded on time',
    recordedBy: { id: 'u1', name: 'Accountant User', email: 'acc@erve.local' },
    recordedAt: '2026-07-05T10:00:00.000Z',
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildInvoiceHandoffDetailViewModel', () => {
  it('maps identity and Tally reference fields', () => {
    const vm = buildInvoiceHandoffDetailViewModel(makeHandoff(), { generatedAt: '2026-07-06T10:00:00Z' });

    expect(vm.identityItems).toContainEqual({ label: 'Style / Size', value: 'ST-1 / Medium' });
    expect(vm.identityItems).toContainEqual({ label: 'Purchase Mode', value: 'Outright' });
    expect(vm.identityItems).toContainEqual({ label: 'Dispatched (Invoiceable) Quantity', value: 20 });
    expect(vm.tallyItems).toContainEqual({ label: 'Tally Invoice #', value: 'TALLY-001' });
    expect(vm.tallyItems).toContainEqual({ label: 'Tally Voucher Reference', value: 'VCH-001' });
    expect(vm.tallyItems.find((i) => i.label === 'Recorded By')?.value).toContain('Accountant User');
  });

  it('renders a PENDING_TALLY handoff with no Tally reference yet', () => {
    const vm = buildInvoiceHandoffDetailViewModel(
      makeHandoff({ status: 'PENDING_TALLY', tallyInvoiceNumber: null, tallyInvoiceDate: null, tallyVoucherReference: null, recordedBy: null, recordedAt: null }),
      { generatedAt: '2026-07-06T10:00:00Z' },
    );
    expect(vm.identityItems).toContainEqual({ label: 'Status', value: 'Pending Tally' });
    expect(vm.tallyItems).toContainEqual({ label: 'Tally Invoice #', value: null });
    expect(vm.tallyItems).toContainEqual({ label: 'Recorded By', value: null });
  });

  it('prints exactly whatever the API returned for a DISTRIBUTOR caller — server-redacted fields stay null, never re-populated', () => {
    // toInvoiceHandoffView(record, full=false) nulls tallyVoucherReference/remarks/recordedBy for a
    // DISTRIBUTOR caller — the view model must never fill these back in from elsewhere.
    const handoff = makeHandoff({ tallyVoucherReference: null, remarks: null, recordedBy: null, recordedAt: null });
    const vm = buildInvoiceHandoffDetailViewModel(handoff, { generatedAt: '2026-07-06T10:00:00Z' });
    expect(vm.tallyItems).toContainEqual({ label: 'Tally Voucher Reference', value: null });
    expect(vm.tallyItems).toContainEqual({ label: 'Remarks', value: null });
    expect(vm.tallyItems).toContainEqual({ label: 'Recorded By', value: null });
    // The Distributor-safe fields (number/date) still print normally.
    expect(vm.tallyItems).toContainEqual({ label: 'Tally Invoice #', value: 'TALLY-001' });
  });

  it('never mislabels this record as a Tax Invoice, GST Invoice, or Commercial Invoice', () => {
    const vm = buildInvoiceHandoffDetailViewModel(makeHandoff(), { generatedAt: '2026-07-06T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toMatch(/tax invoice|gst invoice|commercial invoice/i);
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const handoff = { ...makeHandoff(), internalId: 'secret', auditInternal: 'x' } as InvoiceHandoffView;
    const vm = buildInvoiceHandoffDetailViewModel(handoff, { generatedAt: '2026-07-06T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('auditInternal');
  });
});
