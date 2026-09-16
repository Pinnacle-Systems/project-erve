import { describe, expect, it } from 'vitest';
import type { SaleOrder, SaleOrderDestination, SaleOrderDistributorGroup, SaleOrderLine } from '../../../sale-orders/types.js';
import { buildDispatchOrderDetailViewModel } from './buildDispatchOrderDetailViewModel.js';

function makeDestination(overrides: Partial<SaleOrderDestination> = {}): SaleOrderDestination {
  return {
    id: 'dest-1',
    label: 'Store 1',
    contactName: 'Ravi Kumar',
    contactEmail: null,
    contactPhone: '9876543210',
    addressLine1: '1 MG Road',
    addressLine2: null,
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    postalCode: '600001',
    gstin: '33AAAAA0000A1Z5',
    canMoveDistributor: false,
    ...overrides,
  };
}

function makeLine(overrides: Partial<SaleOrderLine> = {}): SaleOrderLine {
  return {
    id: 'line-1',
    destinationId: 'dest-1',
    styleId: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    sizeId: 'size-1',
    sizeCode: 'M',
    sizeLabel: 'Medium',
    quantity: 10,
    remarks: null,
    ...overrides,
  };
}

function makeDistributorGroup(overrides: Partial<SaleOrderDistributorGroup> = {}): SaleOrderDistributorGroup {
  return {
    id: 'dg-1',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'OUTRIGHT',
    destinations: [makeDestination()],
    lines: [makeLine()],
    ...overrides,
  };
}

function makeSaleOrder(overrides: Partial<SaleOrder> = {}): SaleOrder {
  const distributorGroups = overrides.distributorGroups ?? [makeDistributorGroup()];
  return {
    id: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: distributorGroups.map((g) => ({ ...g.distributor, purchaseMode: g.purchaseMode })),
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    financialYear: { id: 'fy1', code: '2026-27' },
    soDate: '2026-06-30T00:00:00.000Z',
    status: 'ACTIVE',
    destinationCount: distributorGroups.reduce((sum, g) => sum + g.destinations.length, 0),
    totalQuantity: distributorGroups.reduce((sum, g) => sum + g.lines.reduce((s, l) => s + l.quantity, 0), 0),
    createdAt: '2026-06-30T00:00:00.000Z',
    isLocked: false,
    version: 1,
    updatedAt: '2026-06-30T00:00:00.000Z',
    creator: { id: 'u1', name: 'Test Merchandiser', email: 'merch@erve.local' },
    remarks: null,
    distributorGroups,
    lines: distributorGroups.flatMap((g) => g.lines),
    fulfillment: { stage: 'AWAITING_PACKING', totalQuantity: 10, totalFactoryPackedQuantity: 0 },
    ...overrides,
  };
}

const nullRelated = { factoryDispatches: null, erveDispatches: null, auditTrail: null };

describe('buildDispatchOrderDetailViewModel', () => {
  it('maps identity fields, state and fulfillment stage for a single-Distributor/single-Destination order', () => {
    const so = makeSaleOrder();
    const vm = buildDispatchOrderDetailViewModel(so, nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.title).toBe('DISPATCH ORDER');
    expect(vm.subtitle).toBe('EISO/26-27/0001 — Acme Factory');
    expect(vm.identityItems).toEqual(
      expect.arrayContaining([
        { label: 'Dispatch Order Number', value: 'EISO/26-27/0001' },
        { label: 'Factory', value: 'Acme Factory' },
        { label: 'State', value: 'Ready for Factory (editable)' },
        { label: 'Fulfillment', value: 'Awaiting Packing' },
      ]),
    );
  });

  it('shows the locked state label once the Dispatch Order is locked', () => {
    const so = makeSaleOrder({ isLocked: true });
    const vm = buildDispatchOrderDetailViewModel(so, nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.identityItems).toContainEqual({ label: 'State', value: 'Factory Dispatched (locked)' });
  });

  it('never flattens the Distributor -> Destination hierarchy for a mixed-mode, multi-Distributor Dispatch Order', () => {
    const groupA = makeDistributorGroup({
      id: 'dg-a',
      distributor: { id: 'da', code: 'DA', name: 'Distributor A' },
      purchaseMode: 'OUTRIGHT',
      destinations: [makeDestination({ id: 'a1', label: 'A1' }), makeDestination({ id: 'a2', label: 'A2' })],
      lines: [
        makeLine({ id: 'line-a1', destinationId: 'a1', quantity: 5 }),
        makeLine({ id: 'line-a2', destinationId: 'a2', quantity: 7 }),
      ],
    });
    const groupB = makeDistributorGroup({
      id: 'dg-b',
      distributor: { id: 'db', code: 'DB', name: 'Distributor B' },
      purchaseMode: 'SALE_RETURN',
      destinations: [makeDestination({ id: 'b1', label: 'B1' })],
      lines: [makeLine({ id: 'line-b1', destinationId: 'b1', quantity: 9 })],
    });
    const groupC = makeDistributorGroup({
      id: 'dg-c',
      distributor: { id: 'dc', code: 'DC', name: 'Distributor C' },
      purchaseMode: 'OUTRIGHT',
      destinations: [makeDestination({ id: 'c1', label: 'C1' })],
      lines: [makeLine({ id: 'line-c1', destinationId: 'c1', quantity: 3 })],
    });
    const so = makeSaleOrder({ distributorGroups: [groupA, groupB, groupC] });

    const vm = buildDispatchOrderDetailViewModel(so, nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });

    expect(vm.distributorGroups).toHaveLength(3);
    const byName = Object.fromEntries(vm.distributorGroups.map((g) => [g.distributorName, g]));

    expect(byName['Distributor A']?.purchaseModeLabel).toBe('Outright');
    expect(byName['Distributor A']?.destinations.map((d) => d.id)).toEqual(['a1', 'a2']);
    expect(byName['Distributor A']?.totalQuantity).toBe(12);

    expect(byName['Distributor B']?.purchaseModeLabel).toBe('Sale/Return');
    expect(byName['Distributor B']?.destinations.map((d) => d.id)).toEqual(['b1']);

    expect(byName['Distributor C']?.purchaseModeLabel).toBe('Outright');
    expect(byName['Distributor C']?.destinations.map((d) => d.id)).toEqual(['c1']);

    // No cross-group leakage: Distributor A's destinations never include B1/C1, and vice versa.
    for (const group of vm.distributorGroups) {
      const otherDestinationIds = vm.distributorGroups
        .filter((g) => g.id !== group.id)
        .flatMap((g) => g.destinations.map((d) => d.id));
      const thisGroupDestinationIds = group.destinations.map((d) => d.id);
      expect(thisGroupDestinationIds.some((id) => otherDestinationIds.includes(id))).toBe(false);
    }
  });

  it('aggregates Style/Size totals across every Distributor group', () => {
    const groupA = makeDistributorGroup({
      lines: [makeLine({ id: 'l1', styleId: 'style-1', sizeId: 'size-1', quantity: 5 })],
    });
    const groupB = makeDistributorGroup({
      id: 'dg-2',
      distributor: { id: 'd2', code: 'D2', name: 'Beta' },
      destinations: [makeDestination({ id: 'dest-2' })],
      lines: [makeLine({ id: 'l2', destinationId: 'dest-2', styleId: 'style-1', sizeId: 'size-1', quantity: 3 })],
    });
    const so = makeSaleOrder({ distributorGroups: [groupA, groupB] });
    const vm = buildDispatchOrderDetailViewModel(so, nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.styleSizeTotals).toEqual([{ key: 'style-1:size-1', styleDisplay: 'STY-0001 — Basic Tee', sizeLabel: 'Medium', quantity: 8 }]);
    expect(vm.grandTotalQuantity).toBe(so.totalQuantity);
  });

  it('never invents a cancellation field or a partial-fulfilment percentage', () => {
    const vm = buildDispatchOrderDetailViewModel(makeSaleOrder(), nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized.toLowerCase()).not.toContain('cancel');
    expect(serialized).not.toMatch(/%/);
  });

  it('never exposes a Job-Order-level allocation field on a line', () => {
    const vm = buildDispatchOrderDetailViewModel(makeSaleOrder(), nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized.toLowerCase()).not.toContain('joborder');
  });

  it('prints null (not an empty array) for a linked-record section the viewer cannot see', () => {
    const vm = buildDispatchOrderDetailViewModel(makeSaleOrder(), nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.factoryDispatches).toBeNull();
    expect(vm.erveDispatches).toBeNull();
    expect(vm.auditTrail).toBeNull();
  });

  it('maps a populated linked-record section for a permitted viewer', () => {
    const vm = buildDispatchOrderDetailViewModel(
      makeSaleOrder(),
      {
        factoryDispatches: [
          { id: 'fd1', factoryDispatchNumber: 'EIFD/26-27/0001', factory: { id: 'f1', code: 'F1', name: 'Acme Factory' }, saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [] }, status: 'DRAFT', version: 1, preparedAt: '2026-07-01T00:00:00.000Z', finalizedAt: null, consolidated: false },
        ],
        erveDispatches: [],
        auditTrail: [{ id: 'a1', action: 'CREATED', title: 'Dispatch Order created', detail: null, actor: { id: 'u1', name: 'Test Merchandiser', email: 'merch@erve.local' }, createdAt: '2026-06-30T00:00:00.000Z' }],
      },
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.factoryDispatches).toEqual([{ id: 'fd1', factoryDispatchNumber: 'EIFD/26-27/0001', statusLabel: 'Draft' }]);
    expect(vm.erveDispatches).toEqual([]);
    expect(vm.auditTrail?.[0]).toMatchObject({ title: 'Dispatch Order created', actorName: 'Test Merchandiser' });
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const so = { ...makeSaleOrder(), __internalDebugFlag: true, someAuditInternal: 'secret' } as SaleOrder;
    const vm = buildDispatchOrderDetailViewModel(so, nullRelated, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
