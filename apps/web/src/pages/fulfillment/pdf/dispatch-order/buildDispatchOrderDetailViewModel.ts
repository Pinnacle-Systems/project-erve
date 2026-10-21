import { formatPdfDate, formatPdfDateTime } from '../../../../lib/pdf/format.js';
import { toCompactFinancialYearCode } from '../../../../lib/financial-years.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PurchaseMode } from '@erve/types';
import type { DispatchOrderFulfillmentStage, SaleOrder, SaleOrderAuditEntry, SaleOrderLine } from '../../../sale-orders/types.js';
import type { ErveDispatchView, FactoryDispatchSummary } from '../../types.js';
import { FACTORY_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';
import { distinctSizeColumns, groupLinesByStyle, type SizeColumn } from '../../style-size-grouping.js';

const PURCHASE_MODE_LABELS: Record<PurchaseMode, string> = {
  OUTRIGHT: 'Outright',
  SALE_RETURN: 'Sale/Return',
};

const FULFILLMENT_STAGE_LABELS: Record<DispatchOrderFulfillmentStage, string> = {
  AWAITING_PACKING: 'Awaiting Packing',
  PACKING_IN_PROGRESS: 'Packing in Progress',
  FACTORY_DISPATCHED: 'Factory Dispatched',
  ERVE_DISPATCHED: 'Erve Dispatched',
  DELIVERED: 'Delivered',
};

export interface DispatchOrderDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

/** Linked records the viewer's own role may or may not be permitted to see — pass `null` (not `[]`) when the current viewer's permission check excludes the section entirely. */
export interface DispatchOrderDetailPdfRelated {
  factoryDispatches: FactoryDispatchSummary[] | null;
  erveDispatches: ErveDispatchView[] | null;
  auditTrail: SaleOrderAuditEntry[] | null;
}

/** ISS-023 Phase 1: one Style per row, Sizes as dynamic columns — see `PdfStyleSizeMatrix`/`style-size-grouping.ts`. */
export interface DispatchOrderDetailStyleRow {
  styleId: string;
  styleNumber: string;
  styleName: string;
  primaryImage: PdfImageRef | null;
  values: Record<string, number | null>;
}

export interface DispatchOrderDetailDestinationSection {
  id: string;
  label: string;
  addressLine: string;
  contactLine: string | null;
  gstin: string | null;
  totalQuantity: number;
  sizeColumns: SizeColumn[];
  styleRows: DispatchOrderDetailStyleRow[];
}

export interface DispatchOrderDetailDistributorSection {
  id: string;
  distributorName: string;
  purchaseModeLabel: string;
  totalQuantity: number;
  destinations: DispatchOrderDetailDestinationSection[];
}

export interface DispatchOrderDetailFactoryDispatchRow {
  id: string;
  factoryDispatchNumber: string;
  statusLabel: string;
}

export interface DispatchOrderDetailErveDispatchRow {
  id: string;
  erveDispatchNumber: string;
  status: string;
  totalQuantity: number;
}

export interface DispatchOrderDetailAuditRow {
  id: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface DispatchOrderDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  distributorGroups: DispatchOrderDetailDistributorSection[];
  overallSizeColumns: SizeColumn[];
  overallStyleRows: DispatchOrderDetailStyleRow[];
  grandTotalQuantity: number;
  factoryDispatches: DispatchOrderDetailFactoryDispatchRow[] | null;
  erveDispatches: DispatchOrderDetailErveDispatchRow[] | null;
  auditTrail: DispatchOrderDetailAuditRow[] | null;
}

function primaryImageRef(line: SaleOrderLine): PdfImageRef | null {
  return line.primaryImage
    ? { id: line.primaryImage.fileId, path: `/styles/${line.styleId}/images/${line.primaryImage.id}/content` }
    : null;
}

/** ISS-023 Phase 1: groups lines into one Style x Size matrix row set — see `buildStyleSizeRows` on the DOM side (SaleOrderDetailPage.tsx) for the same pattern. `groupLinesByStyle` drops the per-line image, so it's re-attached from the first line seen per styleId (identical across a Style's own lines). */
function buildStyleRows(lines: SaleOrderLine[]): DispatchOrderDetailStyleRow[] {
  const imageByStyleId = new Map<string, PdfImageRef | null>();
  for (const line of lines) {
    if (!imageByStyleId.has(line.styleId)) imageByStyleId.set(line.styleId, primaryImageRef(line));
  }
  return groupLinesByStyle(lines).map((group) => ({
    styleId: group.styleId,
    styleNumber: group.styleNumber,
    styleName: group.styleName,
    primaryImage: imageByStyleId.get(group.styleId) ?? null,
    values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
  }));
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Dispatch Order detail record + its
 * permission-gated linked-record queries + meta into the plain view-model
 * DispatchOrderDetailDocument renders. Field-by-field allowlist, never `...saleOrder`.
 *
 * The Distributor -> Destination -> line hierarchy is preserved exactly as persisted (Correction
 * 8): every destination is nested under its own owning distributorGroups[] entry and never
 * flattened or re-grouped. Purchase Mode is printed once per Distributor group (its snapshot),
 * never inferred from a destination or re-derived from today's Distributor master. There is no
 * cancellation field (Dispatch Order cannot be cancelled), no partial-fulfilment percentage (only
 * the 5-value fulfillment.stage, printed as persisted), and no Job-Order-level traceability
 * (SaleOrderLine carries no jobOrderId — pooled allocation is intentionally not exposed here).
 * factoryDispatches/erveDispatches/auditTrail are `null` (not `[]`) when the current viewer's own
 * permission check excluded that section on-screen, so the document can print "not available for
 * this viewer" rather than a misleading empty list.
 */
export function buildDispatchOrderDetailViewModel(
  so: SaleOrder,
  related: DispatchOrderDetailPdfRelated,
  meta: DispatchOrderDetailPdfMeta,
): DispatchOrderDetailPdfViewModel {
  const identityItems: PdfKeyValueItem[] = [
    { label: 'Dispatch Order Number', value: so.saleOrderNumber },
    { label: 'Factory', value: so.factory.name },
    { label: 'Dispatch Order Date', value: formatPdfDate(so.soDate) },
    { label: 'Financial Year', value: toCompactFinancialYearCode(so.financialYear.code) },
    { label: 'Created By', value: so.creator.name },
    { label: 'Created At', value: formatPdfDateTime(so.createdAt) },
    { label: 'Remarks', value: so.remarks },
    { label: 'State', value: so.isLocked ? 'Factory Dispatched (locked)' : 'Ready for Factory (editable)' },
    { label: 'Fulfillment', value: FULFILLMENT_STAGE_LABELS[so.fulfillment.stage] },
    { label: 'Distributor Count', value: so.distributors.length },
    { label: 'Destination Count', value: so.destinationCount },
    { label: 'Total Quantity', value: so.totalQuantity },
  ];

  const distributorGroups: DispatchOrderDetailDistributorSection[] = so.distributorGroups.map((group) => ({
    id: group.id,
    distributorName: group.distributor.name,
    purchaseModeLabel: PURCHASE_MODE_LABELS[group.purchaseMode],
    totalQuantity: group.lines.reduce((sum, line) => sum + line.quantity, 0),
    destinations: group.destinations.map((dest) => {
      const destLines = group.lines.filter((line) => line.destinationId === dest.id);
      return {
        id: dest.id,
        label: dest.label || dest.city,
        addressLine: [dest.addressLine1, dest.addressLine2, dest.city, dest.state, dest.postalCode, dest.country]
          .filter(Boolean)
          .join(', '),
        contactLine: dest.contactName || dest.contactPhone ? [dest.contactName, dest.contactPhone].filter(Boolean).join(' · ') : null,
        gstin: dest.gstin,
        totalQuantity: destLines.reduce((sum, line) => sum + line.quantity, 0),
        sizeColumns: distinctSizeColumns(destLines),
        styleRows: buildStyleRows(destLines),
      };
    }),
  }));

  return {
    title: 'DISPATCH ORDER',
    subtitle: `${so.saleOrderNumber} — ${so.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    distributorGroups,
    overallSizeColumns: distinctSizeColumns(so.lines),
    overallStyleRows: buildStyleRows(so.lines),
    grandTotalQuantity: so.totalQuantity,
    factoryDispatches: related.factoryDispatches
      ? related.factoryDispatches.map((fd) => ({
          id: fd.id,
          factoryDispatchNumber: fd.factoryDispatchNumber,
          statusLabel: FACTORY_DISPATCH_STATUS_LABELS[fd.status],
        }))
      : null,
    erveDispatches: related.erveDispatches
      ? related.erveDispatches.map((ed) => ({
          id: ed.id,
          erveDispatchNumber: ed.erveDispatchNumber,
          status: ed.status,
          totalQuantity: ed.totalQuantity,
        }))
      : null,
    auditTrail: related.auditTrail
      ? related.auditTrail.map((entry) => ({
          id: entry.id,
          title: entry.title,
          detail: entry.detail,
          actorName: entry.actor?.name ?? null,
          createdAt: formatPdfDateTime(entry.createdAt),
        }))
      : null,
  };
}
