import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryPackingQueueListDocument } from './FactoryPackingQueueListDocument.js';
import type {
  FactoryPackingQueueAwaitingRow,
  FactoryPackingQueueDispatchRow,
  FactoryPackingQueueListPdfViewModel,
} from './buildFactoryPackingQueueListViewModel.js';

function makeAwaitingRow(overrides: Partial<FactoryPackingQueueAwaitingRow> = {}): FactoryPackingQueueAwaitingRow {
  return {
    id: 'line-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributorName: 'Distributor One',
    styleDisplay: 'ST-001 — Classic Tee',
    sizeLabel: 'Medium',
    allocatedQuantity: 40,
    packedQuantity: 10,
    remainingQuantity: 30,
    ...overrides,
  };
}

function makeDispatchRow(overrides: Partial<FactoryPackingQueueDispatchRow> = {}): FactoryPackingQueueDispatchRow {
  return {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    saleOrderNumber: 'EISO/26-27/0001',
    distributorsDisplay: 'Distributor One',
    statusLabel: 'Draft',
    consolidated: '—',
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<FactoryPackingQueueListPdfViewModel> = {}): FactoryPackingQueueListPdfViewModel {
  return {
    title: 'FACTORY PACKING QUEUE',
    subtitle: 'Approved goods allocated from your Factory, awaiting packing',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test Factory User',
    awaitingPackingCount: 1,
    awaitingPacking: [makeAwaitingRow()],
    factoryDispatchCount: 1,
    factoryDispatches: [makeDispatchRow()],
    ...overrides,
  };
}

describe('FactoryPackingQueueListDocument', () => {
  it('renders with zero rows in both sections without throwing', async () => {
    const blob = await pdf(
      <FactoryPackingQueueListDocument viewModel={makeViewModel({ awaitingPackingCount: 0, awaitingPacking: [], factoryDispatchCount: 0, factoryDispatches: [] })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders one row per section without throwing', async () => {
    const blob = await pdf(<FactoryPackingQueueListDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows in both sections spanning multiple pages without throwing', async () => {
    const awaitingPacking = Array.from({ length: 80 }, (_, i) => makeAwaitingRow({ id: `line-${i}` }));
    const factoryDispatches = Array.from({ length: 80 }, (_, i) => makeDispatchRow({ id: `fd-${i}` }));
    const blob = await Promise.race([
      pdf(<FactoryPackingQueueListDocument viewModel={makeViewModel({ awaitingPackingCount: 80, awaitingPacking, factoryDispatchCount: 80, factoryDispatches })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Factory Packing Queue')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
