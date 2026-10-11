import { describe, expect, it } from 'vitest';
import { generateCartonLabelPdfBlob } from './generateCartonLabelPdf.js';
import type { CartonLabelSource } from './buildCartonLabelViewModel.js';
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
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    addressLine1: '123 Test Street',
    addressLine2: null,
    city: 'Chennai',
    state: 'TN',
    country: 'India',
    postalCode: null,
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

describe('generateCartonLabelPdfBlob', () => {
  it('generates a PDF blob for a currently Inspected carton', async () => {
    const blob = await generateCartonLabelPdfBlob(makeSource(), { generatedAt: '2026-09-15T10:00:00Z' });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it.each(['NOT_INSPECTED', 'NEEDS_REINSPECTION'] as const)(
    'refuses to generate a label for a %s carton — labels must come from confirmed/audited data',
    async (auditState) => {
      await expect(
        generateCartonLabelPdfBlob(makeSource({ carton: makeCarton({ auditState }) }), { generatedAt: '2026-09-15T10:00:00Z' }),
      ).rejects.toThrow(/Inspected/);
    },
  );
});
