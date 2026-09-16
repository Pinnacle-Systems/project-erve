import { describe, expect, it } from 'vitest';
import type { FactoryInvoiceView } from '../../types.js';
import { buildFactoryInvoiceDetailViewModel } from './buildFactoryInvoiceDetailViewModel.js';

function makeInvoice(overrides: Partial<FactoryInvoiceView> = {}): FactoryInvoiceView {
  return {
    id: 'fi-1',
    status: 'FACTORY_CONFIRMED',
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    factoryDispatch: { id: 'fd1', factoryDispatchNumber: 'FD/26-27/0001' },
    saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
    generatedAt: '2026-06-30T00:00:00.000Z',
    factoryConfirmedBy: { id: 'u2', name: 'Factory User', email: 'factory@erve.local' },
    factoryConfirmedAt: '2026-07-01T00:00:00.000Z',
    finalizedBy: null,
    finalizedAt: null,
    subtotal: 1000,
    gstAmount: 50,
    total: 1050,
    remarks: 'Handle with care',
    lines: [
      { id: 'l1', saleOrderLineId: 'sol1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 108, defaultRate: 105, unitRate: 95, lineAmount: 10260 },
    ],
    createdAt: '2026-06-30T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildFactoryInvoiceDetailViewModel', () => {
  it('maps identity and totals with INR formatting', () => {
    const vm = buildFactoryInvoiceDetailViewModel(makeInvoice(), { generatedAt: '2026-07-05T10:00:00Z', generatedBy: 'Test Admin' });

    expect(vm.identityItems).toContainEqual({ label: 'Factory', value: 'Acme Factory' });
    expect(vm.identityItems).toContainEqual({ label: 'Status', value: 'Factory Confirmed' });
    expect(vm.subtotal).toBe('INR 1000.00');
    expect(vm.gstAmount).toBe('INR 50.00');
    expect(vm.total).toBe('INR 1050.00');
    expect(vm.remarks).toBe('Handle with care');
  });

  it('quantity regression: prints the persisted invoice line quantity, never a Dispatch Order requested or FactoryDispatch ledger figure', () => {
    // DO requested 120, FactoryDispatch ledger packed 112, physical Factory Packing quantity 108,
    // Factory Invoice persisted quantity 108 — the invoice line only ever carries 108 (this type has
    // no requested/ledger fields at all), proving the PDF cannot re-derive from those upstream figures.
    const invoice = makeInvoice({
      lines: [{ id: 'l1', saleOrderLineId: 'sol1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 108, defaultRate: 105, unitRate: 95, lineAmount: 10260 }],
    });
    const vm = buildFactoryInvoiceDetailViewModel(invoice, { generatedAt: '2026-07-05T10:00:00Z' });
    expect(vm.lines[0]?.quantity).toBe(108);
  });

  it('rate regression: prints the persisted invoice rate snapshot even when it differs from today\'s Style<->Factory mapping', () => {
    // Historical invoice rate INR 95.00, current StyleFactoryMapping fixture would say INR 105.00 —
    // the view model has no access to today's mapping at all, only the invoice's own defaultRate
    // (its generation-time snapshot) and unitRate (its current, possibly-overridden value).
    const invoice = makeInvoice({
      lines: [{ id: 'l1', saleOrderLineId: 'sol1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 108, defaultRate: 105, unitRate: 95, lineAmount: 10260 }],
    });
    const vm = buildFactoryInvoiceDetailViewModel(invoice, { generatedAt: '2026-07-05T10:00:00Z' });
    expect(vm.lines[0]?.unitRate).toBe('INR 95.00');
    expect(vm.lines[0]?.defaultRate).toBe('INR 105.00');
    expect(vm.lines[0]?.rateOverridden).toBe(true);
  });

  it('does not flag an unmodified rate as overridden', () => {
    const invoice = makeInvoice({
      lines: [{ id: 'l1', saleOrderLineId: 'sol1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, defaultRate: 100, unitRate: 100, lineAmount: 1000 }],
    });
    const vm = buildFactoryInvoiceDetailViewModel(invoice, { generatedAt: '2026-07-05T10:00:00Z' });
    expect(vm.lines[0]?.rateOverridden).toBe(false);
  });

  it('renders zero (not the empty dash) for a zero GST amount, and null financial fields safely', () => {
    const vm = buildFactoryInvoiceDetailViewModel(makeInvoice({ gstAmount: 0, remarks: null }), { generatedAt: '2026-07-05T10:00:00Z' });
    expect(vm.gstAmount).toBe('INR 0.00');
    expect(vm.remarks).toBeNull();
  });

  it('shows GENERATED status with no Factory Confirmed / Finalized items', () => {
    const vm = buildFactoryInvoiceDetailViewModel(
      makeInvoice({ status: 'GENERATED', factoryConfirmedBy: null, factoryConfirmedAt: null }),
      { generatedAt: '2026-07-05T10:00:00Z' },
    );
    expect(vm.identityItems.find((i) => i.label === 'Factory Confirmed')?.value).toBeNull();
    expect(vm.identityItems.find((i) => i.label === 'Finalized')?.value).toBeNull();
  });

  it('does not leak unrelated/internal financial properties into the printable view model', () => {
    const invoice = { ...makeInvoice(), internalMargin: 12.5, optimisticVersion: 3, storageKey: 'secret-key' } as FactoryInvoiceView;
    const vm = buildFactoryInvoiceDetailViewModel(invoice, { generatedAt: '2026-07-05T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalMargin');
    expect(serialized).not.toContain('optimisticVersion');
    expect(serialized).not.toContain('storageKey');
  });
});
