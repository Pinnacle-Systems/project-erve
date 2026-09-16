import { formatPdfDate, formatPdfDateTime } from '../../../../lib/pdf/format.js';
import { toCompactFinancialYearCode } from '../../../../lib/financial-years.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PurchaseMode } from '@erve/types';
import type { DispatchOrderFulfillmentStage, SaleOrder, SaleOrderAuditEntry } from '../../../sale-orders/types.js';
import type { ErveDispatchView, FactoryDispatchSummary } from '../../types.js';
import { FACTORY_DISPATCH_STATUS_LABELS } from '../shared/fulfillmentPdfLabels.js';

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

export interface DispatchOrderDetailLineRow {
  id: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
}

export interface DispatchOrderDetailDestinationSection {
  id: string;
  label: string;
  addressLine: string;
  contactLine: string | null;
  gstin: string | null;
  totalQuantity: number;
  lines: DispatchOrderDetailLineRow[];
}

export interface DispatchOrderDetailDistributorSection {
  id: string;
  distributorName: string;
  purchaseModeLabel: string;
  totalQuantity: number;
  destinations: DispatchOrderDetailDestinationSection[];
}

export interface DispatchOrderDetailStyleSizeTotalRow {
  key: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
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
  styleSizeTotals: DispatchOrderDetailStyleSizeTotalRow[];
  grandTotalQuantity: number;
  factoryDispatches: DispatchOrderDetailFactoryDispatchRow[] | null;
  erveDispatches: DispatchOrderDetailErveDispatchRow[] | null;
  auditTrail: DispatchOrderDetailAuditRow[] | null;
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
        lines: destLines.map((line) => ({
          id: line.id,
          styleDisplay: `${line.styleNumber} — ${line.styleName}`,
          sizeLabel: line.sizeLabel,
          quantity: line.quantity,
        })),
      };
    }),
  }));

  const styleSizeTotalsByKey = new Map<string, DispatchOrderDetailStyleSizeTotalRow>();
  for (const line of so.lines) {
    const key = `${line.styleId}:${line.sizeId}`;
    const existing = styleSizeTotalsByKey.get(key);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      styleSizeTotalsByKey.set(key, {
        key,
        styleDisplay: `${line.styleNumber} — ${line.styleName}`,
        sizeLabel: line.sizeLabel,
        quantity: line.quantity,
      });
    }
  }

  return {
    title: 'DISPATCH ORDER',
    subtitle: `${so.saleOrderNumber} — ${so.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    distributorGroups,
    styleSizeTotals: [...styleSizeTotalsByKey.values()],
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
