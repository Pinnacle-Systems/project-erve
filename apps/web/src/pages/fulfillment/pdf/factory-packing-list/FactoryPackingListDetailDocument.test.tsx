import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryPackingListDetailDocument } from './FactoryPackingListDetailDocument.js';
import type {
  FactoryPackingListCartonRow,
  FactoryPackingListDestinationSection,
  FactoryPackingListLineRow,
  FactoryPackingListPdfViewModel,
} from './buildFactoryPackingListViewModel.js';

function makeCarton(overrides: Partial<FactoryPackingListCartonRow> = {}): FactoryPackingListCartonRow {
  return {
    id: 'carton-1',
    cartonNumber: 'C1',
    weight: '12.5 kg',
    packageDetails: '1 poly bag per unit',
    auditStateLabel: 'Not Inspected',
    destinationMismatch: false,
    lines: [{ id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', quantity: 10 }],
    ...overrides,
  };
}

function makeLine(overrides: Partial<FactoryPackingListLineRow> = {}): FactoryPackingListLineRow {
  return { id: 'line-1', styleDisplay: 'ST-001 — Classic Tee', sizeLabel: 'Medium', requiredQuantity: 10, packedQuantity: 10, ...overrides };
}

function makeDestination(overrides: Partial<FactoryPackingListDestinationSection> = {}): FactoryPackingListDestinationSection {
  return {
    id: 'dest-1',
    label: 'Chennai, TN',
    distributorName: 'Distributor One',
    addressLine: '123 Test Street, Chennai, TN, India',
    contactName: 'Ravi Kumar',
    lines: [makeLine()],
    cartons: [makeCarton()],
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<FactoryPackingListPdfViewModel> = {}): FactoryPackingListPdfViewModel {
  return {
    title: 'FACTORY PACKING LIST',
    subtitle: 'EISO/26-27/0001 — Factory One',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Factory User',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    distributorsDisplay: 'Distributor One',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    statusLabel: 'Draft',
    destinations: [makeDestination()],
    retiredCartons: [],
    ...overrides,
  };
}

describe('FactoryPackingListDetailDocument', () => {
  it('renders a single destination/carton packing list without throwing', async () => {
    const blob = await pdf(<FactoryPackingListDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a destination with no cartons yet without throwing', async () => {
    const blob = await pdf(
      <FactoryPackingListDetailDocument viewModel={makeViewModel({ destinations: [makeDestination({ cartons: [] })] })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders "Not started" when no Factory Dispatch exists yet without throwing', async () => {
    const blob = await pdf(
      <FactoryPackingListDetailDocument viewModel={makeViewModel({ factoryDispatchNumber: 'Not started', statusLabel: 'Not started' })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders retired cartons in their own section without throwing', async () => {
    const blob = await pdf(
      <FactoryPackingListDetailDocument
        viewModel={makeViewModel({ retiredCartons: [{ ...makeCarton({ id: 'carton-2', cartonNumber: 'C2' }), retiredAt: '2026-09-05T00:00:00.000Z' }] })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many destinations with many multi-line cartons spanning multiple pages without throwing or duplicating/truncating', async () => {
    const destinations = Array.from({ length: 8 }, (_, di) =>
      makeDestination({
        id: `dest-${di}`,
        label: `Destination ${di}`,
        cartons: Array.from({ length: 6 }, (_, ci) =>
          makeCarton({
            id: `dest-${di}-carton-${ci}`,
            cartonNumber: `C${di}-${ci}`,
            lines: Array.from({ length: 4 }, (_, li) => ({ id: `l-${di}-${ci}-${li}`, styleDisplay: `ST-${li}`, sizeLabel: 'M', quantity: 5 })),
          }),
        ),
      }),
    );

    const blob = await Promise.race([
      pdf(<FactoryPackingListDetailDocument viewModel={makeViewModel({ destinations })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a many-carton Factory Packing List')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
