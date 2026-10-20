import type { FactoryPackingCartonView, PackingListView } from '../../types.js';
import { FACTORY_DISPATCH_STATUS_LABELS, PACKING_AUDIT_STATE_LABELS } from '../shared/fulfillmentPdfLabels.js';
import { distinctSizeColumns, groupLinesByStyle, type SizeColumn } from '../../style-size-grouping.js';

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

/** ISS-010: one row per Style within the carton, Sizes as columns — see `sizeColumns`/`styleRows` on `FactoryPackingListCartonRow`. */
export interface FactoryPackingListCartonStyleRow {
  styleId: string;
  styleNumber: string;
  styleName: string | null;
  values: Record<string, number | null>;
}

export interface FactoryPackingListCartonRow {
  id: string;
  cartonNumber: string;
  // DEMO-018: renamed from `weight` (source: carton.netWeight) — still
  // formatted as "X kg". Scope guard: grossWeight/dimensions are captured
  // and finalize-gated but deliberately NOT yet printed on this PDF — see
  // the DEMO-018 PR description's forward pointer for DEMO-019 carton labels.
  netWeight: string | null;
  packageDetails: string | null;
  auditStateLabel: string;
  destinationMismatch: boolean;
  totalQuantity: number;
  /** Used by the Retired Cartons summary table, which deliberately stays a flat per-carton row (ISS-010 did not touch it — it's already one row per carton, not repeated per Style/Size). */
  lines: FactoryPackingListCartonLineRow[];
  /** ISS-010: Style x Size matrix for this carton's own contents — Sizes in first-appearance order (see style-size-grouping.ts; no Size.sortOrder is available on these views without an API contract change). */
  sizeColumns: SizeColumn[];
  styleRows: FactoryPackingListCartonStyleRow[];
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
    netWeight: carton.netWeight ? `${carton.netWeight} kg` : null,
    packageDetails: carton.packageDetails,
    auditStateLabel: PACKING_AUDIT_STATE_LABELS[carton.auditState],
    destinationMismatch: carton.destinationMismatch,
    totalQuantity: carton.totalQuantity,
    lines: carton.lines.map((line) => ({
      id: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
    })),
    sizeColumns: distinctSizeColumns(carton.lines),
    styleRows: groupLinesByStyle(carton.lines).map((group) => ({
      styleId: group.styleId,
      styleNumber: group.styleNumber,
      styleName: group.styleName,
      values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
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
