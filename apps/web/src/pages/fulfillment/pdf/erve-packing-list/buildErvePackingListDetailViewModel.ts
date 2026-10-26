import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { ERVE_PACKING_LIST_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import {
  distinctSizeColumns,
  groupLinesByStyle,
  withSizeIdentity,
  type SizeColumn,
} from '../../style-size-grouping.js';
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

/** ISS-023: one row per Style within the carton/summary, Sizes as columns — see `sizeColumns`/`styleRows` below. */
export interface ErvePackingListDetailStyleRow {
  styleId: string;
  styleNumber: string;
  styleName: string;
  values: Record<string, number | null>;
  /** ISS-053: the Style's primary image, already resolved to a data URI by prepareErvePackingListDetailPdfImages — never fetched here. */
  image?: PdfImageSource;
}

export interface ErvePackingListDetailCartonRow {
  id: string;
  cartonNumber: string;
  packageDetails: string | null;
  weight: string | null;
  totalQuantity: number;
  lines: ErvePackingListDetailCartonLineRow[];
  /** ISS-023: Style x Size matrix for this carton's own contents — Sizes follow canonical master order when metadata is available (see style-size-grouping.ts). */
  sizeColumns: SizeColumn[];
  styleRows: ErvePackingListDetailStyleRow[];
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
  /** ISS-023: the consolidated Style x Size summary across every carton, Sizes as columns. */
  styleSizeSizeColumns: SizeColumn[];
  styleSizeSummaryRows: ErvePackingListDetailStyleRow[];
  dispatchReference: string | null;
}

function toStyleRows(
  lines: Array<{
    styleId: string;
    styleNumber: string;
    styleName: string;
    sizeCode: string;
    sizeLabel: string;
    quantity: number;
  }>,
  images: Map<string, PdfImageSource>,
): ErvePackingListDetailStyleRow[] {
  return groupLinesByStyle(lines.map(withSizeIdentity)).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
    image: images.get(group.styleId) ?? { placeholder: true },
  }));
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
  /** ISS-053: already-resolved Style primary images, keyed by Style UUID — see prepareErvePackingListDetailPdfImages. */
  images: Map<string, PdfImageSource> = new Map(),
): ErvePackingListDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'EIPL Number', value: packingList.ervePackingListNumber },
    { label: 'Distributor', value: packingList.distributor?.name },
    { label: 'Status', value: ERVE_PACKING_LIST_STATUS_LABELS[packingList.status] },
    { label: 'Created By', value: packingList.createdBy.name },
    { label: 'Created At', value: formatPdfDateTime(packingList.createdAt) },
    { label: 'Finalized By', value: packingList.finalizedBy?.name },
    {
      label: 'Finalized At',
      value: packingList.finalizedAt ? formatPdfDateTime(packingList.finalizedAt) : null,
    },
    { label: 'Cartons', value: packingList.cartonCount },
    { label: 'Total Quantity', value: packingList.totalQuantity },
    // ISS-054: internal factory provenance (Source Factories) and EISO
    // Dispatch Order numbers (Source Dispatch Orders) are never printed on
    // this external, distributor-facing PDF — DEMO-020 only suppressed a
    // stray label when these were absent; this closes the gap and removes
    // them outright, regardless of presence. The authorized web detail page
    // (ErvePackingListDetailPage.tsx) still shows both — PDF-only redaction.
  ];

  const destinationItems: PdfKeyValueItem[] = [
    ...(packingList.destination.storeCode
      ? [{ label: 'Store Code', value: packingList.destination.storeCode }]
      : []),
    ...(packingList.destination.gstin
      ? [{ label: 'Destination GSTIN', value: packingList.destination.gstin }]
      : []),
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
    // ISS-054: carton.factory/saleOrder/factoryDispatchNumber (internal
    // factory provenance, EISO, EIFD) are deliberately never copied onto
    // this PDF-only row — see the identityItems comment above.
    packageDetails: carton.packageDetails,
    weight: carton.weight,
    totalQuantity: carton.totalQuantity,
    lines: carton.lines.map((line) => ({
      saleOrderLineId: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
    })),
    sizeColumns: distinctSizeColumns(carton.lines.map(withSizeIdentity)),
    styleRows: toStyleRows(carton.lines, images),
  }));

  return {
    title: 'Erve Consolidated Packing List',
    subtitle: `${packingList.ervePackingListNumber} — ${packingList.distributor?.name ?? ''}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    destinationItems,
    cartons,
    totalCartonCount: packingList.cartonCount,
    totalQuantity: packingList.totalQuantity,
    styleSizeSizeColumns: distinctSizeColumns(packingList.styleSizeSummary.map(withSizeIdentity)),
    styleSizeSummaryRows: toStyleRows(packingList.styleSizeSummary, images),
    dispatchReference: packingList.dispatch?.erveDispatchNumber ?? null,
  };
}
