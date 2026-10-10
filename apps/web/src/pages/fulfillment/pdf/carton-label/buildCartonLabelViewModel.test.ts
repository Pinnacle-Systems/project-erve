import { describe, expect, it } from 'vitest';
import { buildCartonLabelViewModel, type CartonLabelSource } from './buildCartonLabelViewModel.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from '../../types.js';

function makeCarton(overrides: Partial<FactoryPackingCartonView> = {}): FactoryPackingCartonView {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    destinationId: 'dest-1',
    packageDetails: null,
    netWeight: null,
    grossWeight: null,
    dimensions: null,
    version: 1,
    totalQuantity: 10,
    destinationMismatch: false,
    auditState: 'INSPECTED',
    retired: false,
    retiredAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    lines: [
      { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'M', sizeLabel: 'Medium', quantity: 10, currentDestinationId: 'dest-1' },
    ],
    auditHistory: [],
    ...overrides,
  };
}

function makeDestination(overrides: Partial<PackingListDestinationView> = {}): PackingListDestinationView {
  return {
    id: 'dest-1',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    label: 'Store 1',
    contactName: 'Jane Doe',
    contactEmail: 'jane@example.com',
    contactPhone: '+91-9000000000',
    addressLine1: '123 Test Street',
    addressLine2: 'Unit 4',
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    postalCode: '600001',
    gstin: null,
    canMoveDistributor: false,
    lines: [],
    cartons: [],
    ...overrides,
  };
}

function makeSource(overrides: Partial<CartonLabelSource> = {}): CartonLabelSource {
  return {
    carton: makeCarton(),
    destination: makeDestination(),
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    ...overrides,
  };
}

describe('buildCartonLabelViewModel', () => {
  it('maps carton identity, Dispatch Order/Factory Dispatch references, and the destination snapshot', () => {
    const vm = buildCartonLabelViewModel(makeSource(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.cartonNumber).toBe('C1');
    expect(vm.destinationName).toBe('Store 1');
    expect(vm.identityItems).toEqual([
      { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
      { label: 'Factory', value: 'Factory One' },
      { label: 'Factory Dispatch', value: 'EIFD/26-27/0001' },
      { label: 'Distributor', value: 'Distributor One' },
      { label: 'Destination', value: 'Store 1' },
      { label: 'Address', value: '123 Test Street, Unit 4, Chennai, TN, 600001, India' },
      { label: 'Contact', value: 'Jane Doe' },
      { label: 'Contact Phone', value: '+91-9000000000' },
    ]);
  });

  it('falls back to city/state when the destination has no label', () => {
    const vm = buildCartonLabelViewModel(
      makeSource({ destination: makeDestination({ label: null }) }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.destinationName).toBe('Chennai, TN');
    expect(vm.identityItems.find((i) => i.label === 'Destination')?.value).toBe('Chennai, TN');
  });

  it('uses the carton destination snapshot, never a live distributor/master address lookup', () => {
    // buildCartonLabelViewModel's signature takes the already-loaded PackingListDestinationView
    // (the Dispatch-Order-scoped destination snapshot), never a Distributor master record — this
    // locks in that the only address fields that can ever appear are the ones this test fixture
    // sets on `destination`, confirming there is no separate master-address lookup path.
    const vm = buildCartonLabelViewModel(makeSource(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.identityItems.find((i) => i.label === 'Address')?.value).toContain('123 Test Street');
  });

  it('maps carton contents and total quantity', () => {
    const vm = buildCartonLabelViewModel(makeSource(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.lines).toEqual([{ id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', quantity: 10 }]);
    expect(vm.totalQuantity).toBe(10);
  });

  it('maps multiple size/content lines without dropping any', () => {
    const carton = makeCarton({
      lines: [
        { saleOrderLineId: 'line-1', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-1', sizeCode: 'S', sizeLabel: 'Small', quantity: 4, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-2', styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: null, sizeId: 'size-2', sizeCode: 'M', sizeLabel: 'Medium', quantity: 6, currentDestinationId: 'dest-1' },
        { saleOrderLineId: 'line-3', styleId: 'style-2', styleNumber: 'ST-002', styleName: 'Polo', primaryImage: null, sizeId: 'size-3', sizeCode: 'L', sizeLabel: 'Large', quantity: 8, currentDestinationId: 'dest-1' },
      ],
      totalQuantity: 18,
    });
    const vm = buildCartonLabelViewModel(makeSource({ carton }), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.lines).toHaveLength(3);
    expect(vm.totalQuantity).toBe(18);
  });

  it('omits Net Weight/Gross Weight/Dimensions entirely when absent, rather than printing a placeholder', () => {
    const vm = buildCartonLabelViewModel(makeSource(), { generatedAt: '2026-09-15T10:00:00Z' });
    const labels = vm.identityItems.map((i) => i.label);
    expect(labels).not.toContain('Net Weight');
    expect(labels).not.toContain('Gross Weight');
    expect(labels).not.toContain('Dimensions');
  });

  it('includes Net Weight, Gross Weight, and Dimensions when present', () => {
    const vm = buildCartonLabelViewModel(
      makeSource({ carton: makeCarton({ netWeight: '12.5', grossWeight: '13.2', dimensions: '60 x 40 x 35 cm' }) }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    expect(vm.identityItems).toEqual(
      expect.arrayContaining([
        { label: 'Net Weight', value: '12.5 kg' },
        { label: 'Gross Weight', value: '13.2 kg' },
        { label: 'Dimensions', value: '60 x 40 x 35 cm' },
      ]),
    );
  });

  it('omits Factory Dispatch when not yet assigned', () => {
    const vm = buildCartonLabelViewModel(makeSource({ factoryDispatchNumber: null }), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(vm.identityItems.find((i) => i.label === 'Factory Dispatch')).toBeUndefined();
  });

  it('omits Contact/Contact Phone when the destination has none on file', () => {
    const vm = buildCartonLabelViewModel(
      makeSource({ destination: makeDestination({ contactName: null, contactPhone: null }) }),
      { generatedAt: '2026-09-15T10:00:00Z' },
    );
    const labels = vm.identityItems.map((i) => i.label);
    expect(labels).not.toContain('Contact');
    expect(labels).not.toContain('Contact Phone');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const source = { ...makeSource(), __internalDebugFlag: true } as CartonLabelSource;
    const vm = buildCartonLabelViewModel(source, { generatedAt: '2026-09-15T10:00:00Z' });
    expect(JSON.stringify(vm)).not.toContain('__internalDebugFlag');
  });
});
