import { describe, expect, it } from 'vitest';
import type { ErvePackingListDetail } from '../../types.js';
import { buildErvePackingListDetailViewModel } from './buildErvePackingListDetailViewModel.js';

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
});
