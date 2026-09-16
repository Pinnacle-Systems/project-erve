import type { PackingAuditQueueItem } from '../../types.js';
import { PACKING_AUDIT_STATE_LABELS } from '../shared/fulfillmentPdfLabels.js';

export interface PackingAuditListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface PackingAuditListPdfRow {
  id: string;
  saleOrderNumber: string;
  factoryName: string;
  cartonNumber: string;
  totalQuantity: number;
  auditStateLabel: string;
}

export interface PackingAuditListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: PackingAuditListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-fetched (all-pages) Packing Audit queue + meta into
 * the plain view-model PackingAuditListDocument renders. Field-by-field allowlist, never `...item`.
 * Row order is preserved as returned by the API; the queue has no user-facing sort control today.
 *
 * The title/subtitle deliberately describe this as the QUEUE — every open (non-retired) carton on a
 * still-DRAFT Factory Dispatch, regardless of audit state — never as "all Packing Audits ever",
 * even though the export loops every page of the queue. There is no PASS/FAIL: auditStateLabel is
 * always one of the three derived states (Not Inspected / Inspected / Needs Reinspection).
 */
export function buildPackingAuditListViewModel(
  items: PackingAuditQueueItem[],
  meta: PackingAuditListPdfMeta,
): PackingAuditListPdfViewModel {
  const rows: PackingAuditListPdfRow[] = items.map((item) => ({
    id: item.id,
    saleOrderNumber: item.saleOrder.saleOrderNumber,
    factoryName: item.factory.name,
    cartonNumber: item.cartonNumber,
    totalQuantity: item.totalQuantity,
    auditStateLabel: PACKING_AUDIT_STATE_LABELS[item.auditState],
  }));

  return {
    title: 'PACKING AUDIT QUEUE',
    subtitle: 'Open cartons awaiting or already inspected on active Factory Dispatches',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
