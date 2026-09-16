import { describe, expect, it } from 'vitest';
import type { FactoryPackingCartonView, PackingListView } from '../../types.js';
import { buildFactoryPackingListViewModel } from './buildFactoryPackingListViewModel.js';

function makeCarton(overrides: Partial<FactoryPackingCartonView> = {}): FactoryPackingCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: '1 poly bag per unit',
    weight: '12.5',
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'NOT_INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, currentDestinationId: 'dest-1' },
    ],
    auditHistory: [],
    ...overrides,
  };
}

function makePackingList(overrides: Partial<PackingListView> = {}): PackingListView {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One' }],
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'DRAFT', version: 1, factoryInvoiceId: null },
    destinations: [
      {
        id: 'dest-1',
        distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
        label: null,
        contactName: 'Ravi Kumar',
        contactEmail: null,
        contactPhone: null,
        addressLine1: '123 Test Street',
        addressLine2: null,
        city: 'Chennai',
        state: 'TN',
        country: 'India',
        postalCode: null,
        gstin: null,
        canMoveDistributor: true,
        lines: [
          { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10 },
        ],
        cartons: [makeCarton()],
      },
    ],
    retiredCartons: [],
    ...overrides,
  };
}

describe('buildFactoryPackingListViewModel', () => {
  it('maps identity fields and "Not started" when no Factory Dispatch has begun', () => {
    const vm = buildFactoryPackingListViewModel(makePackingList({ factoryDispatch: null }), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.factoryDispatchNumber).toBe('Not started');
    expect(vm.statusLabel).toBe('Not started');
  });

  it('maps the Factory Dispatch number and status label once packing has begun', () => {
    const vm = buildFactoryPackingListViewModel(makePackingList(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.factoryDispatchNumber).toBe('EIFD/26-27/0001');
    expect(vm.statusLabel).toBe('Draft');
  });

  it('prints only the physical carton-packed aggregate as "Packed" — never the DO-requested quantity or the FactoryDispatchLine-derived ledger — even when all three differ sharply', () => {
    // Three deliberately distinct numbers, matching the three competing "quantity" concepts in this
    // domain: DO_REQUESTED_QUANTITY (120, SaleOrderLine.quantity — the Dispatch Order's own requested
    // qty) vs. FACTORY_DISPATCH_LINE_QUANTITY (112, FactoryDispatchLine.packedQuantity — a separate,
    // derived provenance ledger, explicitly NOT the authoritative "packed" read per its own schema
    // comment) vs. PHYSICAL_PACKED_QUANTITY (108, PackingListLineView.packedQuantity — SUM(
    // FactoryPackingCartonLine.quantity), the sole physical packed aggregate this DTO exposes).
    // FactoryDispatchLine.packedQuantity has no field on PackingListLineView at all — there is no way
    // for this mapper to read it even by accident — so this test also asserts the output never equals
    // that ledger value or the requested value, only the physical aggregate.
    const DO_REQUESTED_QUANTITY = 120;
    const FACTORY_DISPATCH_LINE_QUANTITY = 112;
    const PHYSICAL_PACKED_QUANTITY = 108;
    const packingList = makePackingList({
      destinations: [
        {
          ...makePackingList().destinations[0]!,
          lines: [
            {
              saleOrderLineId: 'line-1',
              styleId: 'style-1',
              styleNumber: 'ST-001',
              styleName: 'Classic Tee',
              sizeId: 'size-1',
              sizeCode: 'M',
              sizeLabel: 'Medium',
              requiredQuantity: DO_REQUESTED_QUANTITY,
              packedQuantity: PHYSICAL_PACKED_QUANTITY,
            },
          ],
        },
      ],
    });
    const vm = buildFactoryPackingListViewModel(packingList, { generatedAt: '2026-09-15T10:00:00Z' });
    const printedLine = vm.destinations[0]?.lines[0];
    expect(printedLine).toMatchObject({ requiredQuantity: DO_REQUESTED_QUANTITY, packedQuantity: PHYSICAL_PACKED_QUANTITY });
    expect(printedLine?.packedQuantity).not.toBe(DO_REQUESTED_QUANTITY);
    expect(printedLine?.packedQuantity).not.toBe(FACTORY_DISPATCH_LINE_QUANTITY);
  });

  it('maps carton weight, package details, audit state label and destination-mismatch flag', () => {
    const vm = buildFactoryPackingListViewModel(
      makePackingList({
        destinations: [
          { ...makePackingList().destinations[0]!, cartons: [makeCarton({ auditState: 'NEEDS_REINSPECTION', destinationMismatch: true })] },
        ],
      }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.destinations[0]?.cartons[0]).toMatchObject({
      cartonNumber: 'C1',
      weight: '12.5 kg',
      packageDetails: '1 poly bag per unit',
      auditStateLabel: 'Needs Reinspection',
      destinationMismatch: true,
    });
  });

  it('never invents a PASS/FAIL audit outcome', () => {
    const vm = buildFactoryPackingListViewModel(makePackingList(), { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized.toLowerCase()).not.toMatch(/\bpass\b|\bfail\b/);
  });

  it('never includes factory-invoice financial fields', () => {
    const vm = buildFactoryPackingListViewModel(
      makePackingList({ factoryDispatch: { id: 'fd-1', factoryDispatchNumber: 'EIFD/26-27/0001', status: 'DRAFT', version: 1, factoryInvoiceId: 'inv-1' } }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('inv-1');
    expect(serialized.toLowerCase()).not.toMatch(/\brate\b|\bgst\b|\binvoice\b/);
  });

  it('lists retired cartons separately with their retirement timestamp', () => {
    const vm = buildFactoryPackingListViewModel(
      makePackingList({ retiredCartons: [makeCarton({ id: 'carton-2', retired: true, retiredAt: '2026-09-05T00:00:00.000Z' })] }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.retiredCartons).toHaveLength(1);
    expect(vm.retiredCartons[0]?.retiredAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const packingList = { ...makePackingList(), __internalDebugFlag: true, someAuditInternal: 'secret' } as PackingListView;
    const vm = buildFactoryPackingListViewModel(packingList, { generatedAt: '2026-09-15T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });
});
