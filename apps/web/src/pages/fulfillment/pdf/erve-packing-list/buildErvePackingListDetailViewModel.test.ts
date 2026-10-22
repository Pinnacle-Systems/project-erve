import { describe, expect, it } from 'vitest';
import type { ErvePackingListDetail } from '../../types.js';
import { buildErvePackingListDetailViewModel } from './buildErvePackingListDetailViewModel.js';

it('prints the persisted Retail Store Code and destination GSTIN', () => {
  const packingList = makePackingList();
  packingList.destination.storeCode = 'ST-OLD';
  packingList.destination.gstin = '22AAAAA0000A1Z5';
  const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-10-08T00:00:00Z' });
  expect(vm.destinationItems).toContainEqual({ label: 'Store Code', value: 'ST-OLD' });
  expect(vm.destinationItems).toContainEqual({ label: 'Destination GSTIN', value: '22AAAAA0000A1Z5' });
});

function makePackingList(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    saleOrder: null,
    destination: {
      label: 'Mumbai Warehouse',
      contactName: 'Ravi Kumar',
      contactEmail: 'ravi@example.com',
      contactPhone: '9999999999',
      addressLine1: '123 Main St',
      addressLine2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '400001',
    },
    status: 'OPEN',
    createdBy: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    createdAt: '2026-06-30T00:00:00.000Z',
    cartonCount: 1,
    totalQuantity: 20,
    sourceFactories: [{ id: 'f1', code: 'F1', name: 'Acme Factory' }],
    sourceDispatchOrders: [{ id: 'so1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    finalizedBy: null,
    finalizedAt: null,
    cartons: [
      {
        id: 'carton-1',
        cartonNumber: 'CTN-001',
        factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
        factoryDispatchId: 'fd-1',
        factoryDispatchNumber: 'FD/26-27/0001',
        saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
        packageDetails: 'Standard box',
        weight: '5kg',
        totalQuantity: 20,
        lines: [{ saleOrderLineId: 'sol-1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 }],
      },
    ],
    styleSizeSummary: [{ styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 }],
    ...overrides,
  };
}

it('orders actual carton and consolidated PDF matrices by authoritative ranks through business-key adapters', () => {
  const packingList = makePackingList();
  const lines = [
    { saleOrderLineId: 'medium', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', sizeSortOrder: 4, quantity: 13 },
    { saleOrderLineId: 'small', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'S', sizeLabel: 'Small', sizeSortOrder: 0, quantity: 7 },
  ];
  packingList.cartons[0]!.lines = lines;
  packingList.styleSizeSummary = lines;
  const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-10-08T00:00:00Z' });
  expect(vm.cartons[0]!.sizeColumns.map((column) => column.sizeCode)).toEqual(['S', 'M']);
  expect(vm.styleSizeSizeColumns.map((column) => column.sizeCode)).toEqual(['S', 'M']);
  expect(vm.cartons[0]!.styleRows[0]!.values).toEqual({ S: 7, M: 13 });
  expect(vm.styleSizeSummaryRows[0]!.values).toEqual({ S: 7, M: 13 });
  expect(vm.totalQuantity).toBe(20);
});

describe('buildErvePackingListDetailViewModel', () => {
  it('maps identity, destination snapshot, and totals', () => {
    const vm = buildErvePackingListDetailViewModel(makePackingList(), { generatedAt: '2026-07-01T10:00:00Z', generatedBy: 'Test Admin' });

    expect(vm.identityItems).toContainEqual({ label: 'EIPL Number', value: 'EIPL/26-27/0001' });
    expect(vm.identityItems).toContainEqual({ label: 'Distributor', value: 'Acme Distributors' });
    expect(vm.identityItems).toContainEqual({ label: 'Status', value: 'Open' });
    expect(vm.destinationItems).toContainEqual({ label: 'Contact Name', value: 'Ravi Kumar' });
    expect(vm.destinationItems.find((i) => i.label === 'Address')?.value).toBe('123 Main St, Mumbai, Maharashtra, 400001, India');
    expect(vm.totalCartonCount).toBe(1);
    expect(vm.totalQuantity).toBe(20);
    expect(vm.dispatchReference).toBeNull();
  });

  it('preserves each carton\'s own Factory/Dispatch Order provenance when cartons span multiple sources', () => {
    const packingList = makePackingList({
      cartonCount: 2,
      totalQuantity: 40,
      sourceFactories: [
        { id: 'f1', code: 'F1', name: 'Factory One' },
        { id: 'f2', code: 'F2', name: 'Factory Two' },
      ],
      sourceDispatchOrders: [
        { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
        { id: 'so2', saleOrderNumber: 'EISO/26-27/0002' },
      ],
      cartons: [
        {
          id: 'carton-1',
          cartonNumber: 'CTN-001',
          factory: { id: 'f1', code: 'F1', name: 'Factory One' },
          factoryDispatchId: 'fd-1',
          factoryDispatchNumber: 'FD/26-27/0001',
          saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
          packageDetails: null,
          weight: null,
          totalQuantity: 20,
          lines: [{ saleOrderLineId: 'sol-1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 20 }],
        },
        {
          id: 'carton-2',
          cartonNumber: 'CTN-002',
          factory: { id: 'f2', code: 'F2', name: 'Factory Two' },
          factoryDispatchId: 'fd-2',
          factoryDispatchNumber: 'FD/26-27/0002',
          saleOrder: { id: 'so2', saleOrderNumber: 'EISO/26-27/0002' },
          packageDetails: null,
          weight: null,
          totalQuantity: 20,
          lines: [{ saleOrderLineId: 'sol-2', styleNumber: 'ST-2', styleName: 'Pants', sizeCode: 'L', sizeLabel: 'Large', quantity: 20 }],
        },
      ],
    });

    const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });

    expect(vm.cartons).toHaveLength(2);
    expect(vm.cartons[0]).toMatchObject({ factoryName: 'Factory One', saleOrderNumber: 'EISO/26-27/0001', factoryDispatchNumber: 'FD/26-27/0001' });
    expect(vm.cartons[1]).toMatchObject({ factoryName: 'Factory Two', saleOrderNumber: 'EISO/26-27/0002', factoryDispatchNumber: 'FD/26-27/0002' });
    // The carton-line quantity, never a Dispatch Order requested/FactoryDispatch summary quantity.
    expect(vm.cartons[0]?.lines[0]?.quantity).toBe(20);
    expect(vm.cartons[1]?.lines[0]?.quantity).toBe(20);
  });

  it('shows the Erve Dispatch reference once dispatched', () => {
    const vm = buildErvePackingListDetailViewModel(
      makePackingList({ status: 'DISPATCHED', dispatch: { id: 'ed-1', erveDispatchNumber: 'ED/26-27/0001', status: 'DISPATCHED' } }),
      { generatedAt: '2026-07-01T10:00:00Z' },
    );
    expect(vm.dispatchReference).toBe('ED/26-27/0001');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const packingList = { ...makePackingList(), internalId: 'secret', auditInternal: 'x' } as ErvePackingListDetail;
    const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('internalId');
    expect(serialized).not.toContain('auditInternal');
  });

  // ISS-023 Phase 3: carton/summary contents as one Style row x Size columns, instead of one flat
  // row per Style+Size combination — aggregation must reconcile exactly with the source carton data.
  describe('Style x Size matrix aggregation', () => {
    it('groups multiple Sizes of the same Style into a single carton row instead of repeating the Style', () => {
      const packingList = makePackingList({
        cartons: [
          {
            id: 'carton-1',
            cartonNumber: 'CTN-001',
            factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
            factoryDispatchId: 'fd-1',
            factoryDispatchNumber: 'FD/26-27/0001',
            saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
            packageDetails: null,
            weight: null,
            totalQuantity: 7,
            lines: [
              { saleOrderLineId: 'sol-1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'S', sizeLabel: 'Small', quantity: 3 },
              { saleOrderLineId: 'sol-2', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4 },
            ],
          },
        ],
      });

      const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });

      expect(vm.cartons[0]?.styleRows).toHaveLength(1);
      expect(vm.cartons[0]?.sizeColumns).toHaveLength(2);
      expect(vm.cartons[0]?.styleRows[0]?.values).toEqual({ S: 3, M: 4 });
    });

    it('groups two different Styles into two separate carton rows, never merged by shared Size', () => {
      const packingList = makePackingList({
        cartons: [
          {
            id: 'carton-1',
            cartonNumber: 'CTN-001',
            factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
            factoryDispatchId: 'fd-1',
            factoryDispatchNumber: 'FD/26-27/0001',
            saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
            packageDetails: null,
            weight: null,
            totalQuantity: 10,
            lines: [
              { saleOrderLineId: 'sol-1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 6 },
              { saleOrderLineId: 'sol-2', styleNumber: 'ST-2', styleName: 'Pants', sizeCode: 'M', sizeLabel: 'Medium', quantity: 4 },
            ],
          },
        ],
      });

      const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });

      expect(vm.cartons[0]?.styleRows).toHaveLength(2);
      expect(vm.cartons[0]?.styleRows.map((r) => r.values.M)).toEqual([6, 4]);
    });

    it('consolidates the same Style/Size across multiple cartons from different Factories/Dispatch Orders into one Style/Size Summary row without double counting', () => {
      const packingList = makePackingList({
        cartonCount: 2,
        totalQuantity: 14,
        sourceFactories: [
          { id: 'f1', code: 'F1', name: 'Factory One' },
          { id: 'f2', code: 'F2', name: 'Factory Two' },
        ],
        cartons: [
          {
            id: 'carton-1',
            cartonNumber: 'CTN-001',
            factory: { id: 'f1', code: 'F1', name: 'Factory One' },
            factoryDispatchId: 'fd-1',
            factoryDispatchNumber: 'FD/26-27/0001',
            saleOrder: { id: 'so1', saleOrderNumber: 'EISO/26-27/0001' },
            packageDetails: null,
            weight: null,
            totalQuantity: 6,
            lines: [{ saleOrderLineId: 'sol-1', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 6 }],
          },
          {
            id: 'carton-2',
            cartonNumber: 'CTN-002',
            factory: { id: 'f2', code: 'F2', name: 'Factory Two' },
            factoryDispatchId: 'fd-2',
            factoryDispatchNumber: 'FD/26-27/0002',
            saleOrder: { id: 'so2', saleOrderNumber: 'EISO/26-27/0002' },
            packageDetails: null,
            weight: null,
            totalQuantity: 8,
            lines: [{ saleOrderLineId: 'sol-2', styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 8 }],
          },
        ],
        styleSizeSummary: [{ styleNumber: 'ST-1', styleName: 'Shirt', sizeCode: 'M', sizeLabel: 'Medium', quantity: 14 }],
      });

      const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });

      // Each carton keeps its own row (per-carton provenance never collapses)...
      expect(vm.cartons).toHaveLength(2);
      expect(vm.cartons[0]?.styleRows[0]?.values.M).toBe(6);
      expect(vm.cartons[1]?.styleRows[0]?.values.M).toBe(8);
      // ...but the consolidated summary is one row, correctly totaled, not double-counted.
      expect(vm.styleSizeSummaryRows).toHaveLength(1);
      expect(vm.styleSizeSummaryRows[0]?.values.M).toBe(14);
    });
  });

  // DEMO-020: sourceFactories/carton.factory*/factoryDispatch* are
  // confidential factory/supplier provenance, omitted entirely (not nulled)
  // by the API for any role outside ERVE_PACKING_LIST_PROVENANCE_ROLES. This
  // page's download/print are only ever reachable by that same authorized
  // role set today, so there is no real request that omits these fields yet
  // — but if the input ever lacks them, the PDF view model (and therefore
  // the printed/downloaded document, which is built purely from this model)
  // must not surface them anyway.
  it('omits Source Factories and every carton factory/Factory-Packing-List field when the source record lacks provenance', () => {
    const full = makePackingList();
    const { sourceFactories: _sourceFactories, ...withoutSourceFactories } = full;
    const packingList: ErvePackingListDetail = {
      ...withoutSourceFactories,
      cartons: full.cartons.map(({ factory: _factory, factoryDispatchId: _factoryDispatchId, factoryDispatchNumber: _factoryDispatchNumber, ...carton }) => carton),
    };

    const vm = buildErvePackingListDetailViewModel(packingList, { generatedAt: '2026-07-01T10:00:00Z' });

    expect(vm.identityItems.find((i) => i.label === 'Source Factories')).toBeUndefined();
    expect(vm.cartons[0]?.factoryName).toBeNull();
    expect(vm.cartons[0]?.factoryDispatchNumber).toBeNull();
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('Acme Factory');
    expect(serialized).not.toContain('FD/26-27/0001');

    // Non-confidential fields are unaffected.
    expect(vm.identityItems.find((i) => i.label === 'Source Dispatch Orders')?.value).toBe('EISO/26-27/0001');
    expect(vm.cartons[0]?.cartonNumber).toBe('CTN-001');
  });
});
