import type { FactoryPackingCartonView, PackingListView } from '../../types.js';
import { FACTORY_DISPATCH_STATUS_LABELS, PACKING_AUDIT_STATE_LABELS } from '../shared/fulfillmentPdfLabels.js';

export interface FactoryPackingListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryPackingListCartonLineRow {
  id: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
}

export interface FactoryPackingListCartonRow {
  id: string;
  cartonNumber: string;
  weight: string | null;
  packageDetails: string | null;
  auditStateLabel: string;
  destinationMismatch: boolean;
  lines: FactoryPackingListCartonLineRow[];
}

export interface FactoryPackingListRetiredCartonRow extends FactoryPackingListCartonRow {
  retiredAt: string | null;
}

export interface FactoryPackingListLineRow {
  id: string;
  styleDisplay: string;
  sizeLabel: string;
  requiredQuantity: number;
  packedQuantity: number;
}

export interface FactoryPackingListDestinationSection {
  id: string;
  label: string;
  distributorName: string;
  addressLine: string;
  contactName: string | null;
  lines: FactoryPackingListLineRow[];
  cartons: FactoryPackingListCartonRow[];
}

export interface FactoryPackingListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  saleOrderNumber: string;
  factoryName: string;
  distributorsDisplay: string;
  factoryDispatchNumber: string;
  statusLabel: string;
  destinations: FactoryPackingListDestinationSection[];
  retiredCartons: FactoryPackingListRetiredCartonRow[];
}

function buildCartonRow(carton: FactoryPackingCartonView): FactoryPackingListCartonRow {
  return {
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    weight: carton.weight ? `${carton.weight} kg` : null,
    packageDetails: carton.packageDetails,
    auditStateLabel: PACKING_AUDIT_STATE_LABELS[carton.auditState],
    destinationMismatch: carton.destinationMismatch,
    lines: carton.lines.map((line) => ({
      id: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
    })),
  };
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Factory Packing List record + meta into the
 * plain view-model FactoryPackingListDetailDocument renders. Field-by-field allowlist, never
 * `...packingList`.
 *
 * "Packed" is always `PackingListLineView.packedQuantity` — the physical carton-packed aggregate
 * the API itself computes from FactoryPackingCartonLine rows — never independently recalculated
 * here and never confused with the Dispatch Order's own requested quantity (a separate field on
 * the same row). Audit state is the current persisted three-value state (never PASS/FAIL). No
 * Factory Invoice financial fields (rate/amount/GST) are read even though `factoryDispatch.
 * factoryInvoiceId` exists on the loaded record — that belongs to a later phase.
 */
export function buildFactoryPackingListViewModel(
  packingList: PackingListView,
  meta: FactoryPackingListPdfMeta,
): FactoryPackingListPdfViewModel {
  const dispatch = packingList.factoryDispatch;
  const distributorsDisplay = packingList.distributors.map((d) => d.name).join(', ');

  const destinations: FactoryPackingListDestinationSection[] = packingList.destinations.map((destination) => ({
    id: destination.id,
    label: destination.label ?? `${destination.city}, ${destination.state}`,
    distributorName: destination.distributor.name,
    addressLine: [destination.addressLine1, destination.addressLine2, destination.city, destination.state, destination.country]
      .filter(Boolean)
      .join(', '),
    contactName: destination.contactName,
    lines: destination.lines.map((line) => ({
      id: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      requiredQuantity: line.requiredQuantity,
      packedQuantity: line.packedQuantity,
    })),
    cartons: destination.cartons.map(buildCartonRow),
  }));

  const retiredCartons: FactoryPackingListRetiredCartonRow[] = packingList.retiredCartons.map((carton) => ({
    ...buildCartonRow(carton),
    retiredAt: carton.retiredAt,
  }));

  return {
    title: 'FACTORY PACKING LIST',
    subtitle: `${packingList.saleOrderNumber} — ${packingList.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    saleOrderNumber: packingList.saleOrderNumber,
    factoryName: packingList.factory.name,
    distributorsDisplay,
    factoryDispatchNumber: dispatch?.factoryDispatchNumber ?? 'Not started',
    statusLabel: dispatch ? FACTORY_DISPATCH_STATUS_LABELS[dispatch.status] : 'Not started',
    destinations,
    retiredCartons,
  };
}
