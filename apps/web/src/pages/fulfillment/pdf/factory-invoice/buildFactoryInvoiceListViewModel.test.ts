import { describe, expect, it } from 'vitest';
import type { FactoryInvoiceView } from '../../types.js';
import { buildFactoryInvoiceListViewModel } from './buildFactoryInvoiceListViewModel.js';

function makeInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return {
    id: 'fi-1',
    status: 'GENERATED',
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    factoryDispatch: { id: 'fd1', factoryDispatchNumber: 'FD/26-27/0001' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    generatedAt: '2026-06-30T00:00:00.000Z',
    factoryConfirmedBy: null,
    factoryConfirmedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    subtotal: 1000,
    gstAmount: 50,
    total: 1050,
    remarks: null,
    lines: [
      { id: 'l1', saleOrderLineId: 'sol1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, defaultRate: 100, unitRate: 100, lineAmount: 1000 },
    ],
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFactoryInvoiceListViewModel', () => {
  it('maps rows with INR-formatted totals and status label', () => {
    const vm = buildFactoryInvoiceListViewModel([makeInvoice()], { status: 'GENERATED' }, { generatedAt: '2026-07-01T10:00:00Z' });

    expect(vm.totalCount).toBe(1);
    expect(vm.rows[0]).toEqual({
      id: 'fi-1',
      factoryName: 'Acme Factory',
      saleOrderNumber: 'EISO/26-27/0001',
      factoryDispatchNumber: 'FD/26-27/0001',
      lineCount: 1,
      subtotal: 'INR 1000.00',
      gstAmount: 'INR 50.00',
      total: 'INR 1050.00',
      statusLabel: 'Awaiting Factory Confirmation',
    });
  });

  it('includes the active Status filter in the filter summary', () => {
    const vm = buildFactoryInvoiceListViewModel([], { status: 'FINALIZED' }, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.filters).toEqual([{ label: 'Status', value: 'Finalized' }]);
  });

  it('shows no active Status filter for the "All" tab', () => {
    const vm = buildFactoryInvoiceListViewModel([], {}, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.filters).toEqual([{ label: 'Status', value: '' }]);
  });

  it('renders zero (not the empty dash) for a zero subtotal', () => {
    const vm = buildFactoryInvoiceListViewModel([makeInvoice({ subtotal: 0, gstAmount: 0, total: 0 })], {}, { generatedAt: '2026-07-01T10:00:00Z' });
    expect(vm.rows[0]?.subtotal).toBe('INR 0.00');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const invoice = { ...makeInvoice(), internalCost: 999, auditInternal: 'x' } as FactoryInvoiceView;
    const vm = buildFactoryInvoiceListViewModel([invoice], {}, { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalCost');
    expect(serialized).not.toContain('auditInternal');
  });
});
