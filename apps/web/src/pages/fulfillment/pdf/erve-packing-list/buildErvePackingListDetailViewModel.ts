import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { ERVE_PACKING_LIST_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import type { ErvePackingListDetail } from '../../types.js';

export interface ErvePackingListDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface ErvePackingListDetailCartonLineRow {
  saleOrderLineId: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
}

export interface ErvePackingListDetailCartonRow {
  id: string;
  cartonNumber: string;
  factoryName: string;
  saleOrderNumber: string;
  factoryDispatchNumber: string;
  packageDetails: string | null;
  weight: string | null;
  totalQuantity: number;
  lines: ErvePackingListDetailCartonLineRow[];
}

export interface ErvePackingListDetailStyleSizeRow {
  key: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
}

export interface ErvePackingListDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  destinationItems: PdfKeyValueItem[];
  cartons: ErvePackingListDetailCartonRow[];
  totalCartonCount: number;
  totalQuantity: number;
  styleSizeSummary: ErvePackingListDetailStyleSizeRow[];
  dispatchReference: string | null;
}

/**
 * Pure, synchronous, no HTTP — maps an already-loaded Erve Packing List detail record + meta into
 * the plain view-model ErvePackingListDetailDocument renders. Field-by-field allowlist, never
 * `...packingList`.
 *
 * Carton membership and carton-line quantities (never the original Dispatch Order requested
 * quantity or a FactoryDispatch summary quantity) are the sole quantity source — mirrors the
 * schema's own authority rule (ErvePackingList module doc: "carton membership lives on
 * FactoryPackingCarton.ervePackingListId ... exactly one packed-quantity ledger:
 * FactoryPackingCartonLine"). Every carton keeps its own source Factory/Dispatch Order/Factory
 * Packing List reference so cross-DO/cross-Factory consolidation stays visible per carton, never
 * implying quantities are allocated to a single Job Order. destinationItems is built entirely from
 * the persisted destination snapshot (never today's live Distributor/Destination master data) —
 * this Consolidated Packing List's destination is a cross-order business fact of its own.
 */
export function buildErvePackingListDetailViewModel(
  packingList: ErvePackingListDetail,
  meta: ErvePackingListDetailPdfMeta,
): ErvePackingListDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'EIPL Number', value: packingList.ervePackingListNumber },
    { label: 'Distributor', value: packingList.distributor?.name },
    { label: 'Status', value: ERVE_PACKING_LIST_STATUS_LABELS[packingList.status] },
    { label: 'Created By', value: packingList.createdBy.name },
    { label: 'Created At', value: formatPdfDateTime(packingList.createdAt) },
    { label: 'Finalized By', value: packingList.finalizedBy?.name },
    { label: 'Finalized At', value: packingList.finalizedAt ? formatPdfDateTime(packingList.finalizedAt) : null },
    { label: 'Cartons', value: packingList.cartonCount },
    { label: 'Total Quantity', value: packingList.totalQuantity },
    { label: 'Source Factories', value: packingList.sourceFactories.map((f) => f.name).join(', ') || null },
    { label: 'Source Dispatch Orders', value: packingList.sourceDispatchOrders.map((s) => s.saleOrderNumber).join(', ') || null },
  ];

  const destinationItems: PdfKeyValueItem[] = [
    { label: 'Destination', value: packingList.destination.label },
    {
      label: 'Address',
      value:
        [
          packingList.destination.addressLine1,
          packingList.destination.addressLine2,
          packingList.destination.city,
          packingList.destination.state,
          packingList.destination.postalCode,
          packingList.destination.country,
        ]
          .filter(Boolean)
          .join(', ') || null,
    },
    { label: 'Contact Name', value: packingList.destination.contactName },
    { label: 'Contact Phone', value: packingList.destination.contactPhone },
    { label: 'Contact Email', value: packingList.destination.contactEmail },
  ];

  const cartons: ErvePackingListDetailCartonRow[] = packingList.cartons.map((carton) => ({
    id: carton.id,
    cartonNumber: carton.cartonNumber,
    factoryName: carton.factory.name,
    saleOrderNumber: carton.saleOrder.saleOrderNumber,
    factoryDispatchNumber: carton.factoryDispatchNumber,
    packageDetails: carton.packageDetails,
    weight: carton.weight,
    totalQuantity: carton.totalQuantity,
    lines: carton.lines.map((line) => ({
      saleOrderLineId: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
    })),
  }));

  const styleSizeSummary: ErvePackingListDetailStyleSizeRow[] = packingList.styleSizeSummary.map((row) => ({
    key: `${row.styleNumber}-${row.sizeCode}`,
    styleDisplay: `${row.styleNumber} — ${row.styleName}`,
    sizeLabel: row.sizeLabel,
    quantity: row.quantity,
  }));

  return {
    title: 'ERVE PACKING LIST',
    subtitle: `${packingList.ervePackingListNumber} — ${packingList.distributor?.name ?? ''}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    destinationItems,
    cartons,
    totalCartonCount: packingList.cartonCount,
    totalQuantity: packingList.totalQuantity,
    styleSizeSummary,
    dispatchReference: packingList.dispatch?.erveDispatchNumber ?? null,
  };
}
