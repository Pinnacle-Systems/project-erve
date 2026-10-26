import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PackingAuditQueueItem } from '../../types.js';
import {
  distinctSizeColumns,
  groupLinesByStyle,
  type SizeColumn,
} from '../../style-size-grouping.js';
import { PACKING_AUDIT_STATE_LABELS } from '../shared/fulfillmentPdfLabels.js';

export type PackingAuditCartonDetailSource = PackingAuditQueueItem & { factoryDispatchId: string };

export interface PackingAuditCartonDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

/** ISS-023 Phase 2: one Style x Size row within the carton's own contents matrix — see `PackingAuditCartonDetailPdfViewModel.styleRows`. */
export interface PackingAuditCartonDetailStyleRow {
  styleId: string;
  styleNumber: string;
  styleName: string | null;
  image?: PdfImageSource;
  values: Record<string, number | null>;
}

export interface PackingAuditCartonDetailHistoryRow {
  cartonVersion: number;
  inspectedByName: string;
  inspectedAt: string;
  remarks: string | null;
}

export interface PackingAuditCartonDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  retired: boolean;
  destinationMismatch: boolean;
  totalQuantity: number;
  sizeColumns: SizeColumn[];
  styleRows: PackingAuditCartonDetailStyleRow[];
  auditHistory: PackingAuditCartonDetailHistoryRow[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded (server-persisted) Packing Audit carton
 * record + meta into the plain view-model PackingAuditCartonDetailDocument renders. Field-by-field
 * allowlist, never `...carton`.
 *
 * The "Confirm Inspected" remarks textarea is local component state on the page
 * (PackingAuditCartonDetailPage.tsx's own `useState`) and is never passed into this function — only
 * `carton.auditHistory[].remarks` (server-persisted, one entry per past confirmation) ever reaches
 * the document, so there is no code path for unsaved form text to leak into the printed PDF. Audit
 * state is always the current persisted three-value state (never PASS/FAIL).
 */
export function buildPackingAuditCartonDetailViewModel(
  carton: PackingAuditCartonDetailSource,
  meta: PackingAuditCartonDetailPdfMeta,
  images: Map<string, PdfImageSource> = new Map(),
): PackingAuditCartonDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'Carton Number', value: carton.cartonNumber },
    { label: 'Dispatch Order', value: carton.saleOrder.saleOrderNumber },
    { label: 'Factory', value: carton.factory.name },
    { label: 'Distributor', value: carton.destination.distributor.name },
    { label: 'Destination', value: carton.destination.label ?? carton.destination.city },
    { label: 'Audit State', value: PACKING_AUDIT_STATE_LABELS[carton.auditState] },
  ];

  return {
    title: 'PACKING AUDIT CARTON',
    subtitle: `Carton ${carton.cartonNumber} — ${carton.saleOrder.saleOrderNumber} · ${carton.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    retired: carton.retired,
    destinationMismatch: carton.destinationMismatch,
    totalQuantity: carton.totalQuantity,
    sizeColumns: distinctSizeColumns(carton.lines),
    styleRows: groupLinesByStyle(carton.lines).map((group) => ({
      styleId: group.styleId,
      styleNumber: group.styleNumber,
      styleName: group.styleName,
      image: images.get(group.styleId) ?? { placeholder: true },
      values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
    })),
    auditHistory: carton.auditHistory.map((entry) => ({
      cartonVersion: entry.cartonVersion,
      inspectedByName: entry.inspectedByName,
      inspectedAt: formatPdfDateTime(entry.inspectedAt),
      remarks: entry.remarks,
    })),
  };
}
