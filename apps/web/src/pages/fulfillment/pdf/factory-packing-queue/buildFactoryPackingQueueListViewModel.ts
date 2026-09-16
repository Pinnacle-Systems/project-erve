import type { FactoryDispatchSummary, FactoryPackingQueueLine } from '../../types.js';
import { FACTORY_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';

export interface FactoryPackingQueueListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryPackingQueueAwaitingRow {
  id: string;
  saleOrderNumber: string;
  distributorName: string;
  styleDisplay: string;
  sizeLabel: string;
  allocatedQuantity: number;
  packedQuantity: number;
  remainingQuantity: number;
}

export interface FactoryPackingQueueDispatchRow {
  id: string;
  factoryDispatchNumber: string;
  saleOrderNumber: string;
  distributorsDisplay: string;
  statusLabel: string;
  consolidated: string;
}

export interface FactoryPackingQueueListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  awaitingPackingCount: number;
  awaitingPacking: FactoryPackingQueueAwaitingRow[];
  factoryDispatchCount: number;
  factoryDispatches: FactoryPackingQueueDispatchRow[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded "Awaiting Packing" queue (unbounded,
 * server-side) and the all-pages-fetched "Your Factory Dispatches" list into the plain view-model
 * FactoryPackingQueueListDocument renders. Field-by-field allowlist, never `...line`/`...dispatch`.
 * Row order is preserved as returned by the API for each section.
 */
export function buildFactoryPackingQueueListViewModel(
  awaitingPacking: FactoryPackingQueueLine[],
  factoryDispatches: FactoryDispatchSummary[],
  meta: FactoryPackingQueueListPdfMeta,
): FactoryPackingQueueListPdfViewModel {
  const awaitingRows: FactoryPackingQueueAwaitingRow[] = awaitingPacking.map((line) => ({
    id: line.saleOrderLineId,
    saleOrderNumber: line.saleOrderNumber,
    distributorName: line.distributor.name,
    styleDisplay: `${line.styleNumber} — ${line.styleName}`,
    sizeLabel: line.sizeLabel,
    allocatedQuantity: line.allocatedQuantity,
    packedQuantity: line.packedQuantity,
    remainingQuantity: line.remainingQuantity,
  }));

  const dispatchRows: FactoryPackingQueueDispatchRow[] = factoryDispatches.map((dispatch) => ({
    id: dispatch.id,
    factoryDispatchNumber: dispatch.factoryDispatchNumber,
    saleOrderNumber: dispatch.saleOrder.saleOrderNumber,
    distributorsDisplay: dispatch.saleOrder.distributors.map((d) => d.name).join(', '),
    statusLabel: FACTORY_DISPATCH_STATUS_LABELS[dispatch.status],
    consolidated: dispatch.consolidated ? 'Yes' : '—',
  }));

  return {
    title: 'FACTORY PACKING QUEUE',
    subtitle: 'Approved goods allocated from your Factory, awaiting packing',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    awaitingPackingCount: awaitingRows.length,
    awaitingPacking: awaitingRows,
    factoryDispatchCount: dispatchRows.length,
    factoryDispatches: dispatchRows,
  };
}
