import { Prisma } from '../../db/prisma.js';
import type { ReconciliationSummary } from '@erve/types';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
export const reconciliationQueueSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  distributorId: z.string().trim().min(1).max(200).optional(),
  dispatchReference: z.string().trim().max(100).optional(),
  discrepancy: flag,
  shortage: flag,
  allZero: flag,
  awaitingReceipt: flag,
  pendingReview: flag,
});
export type ReconciliationFilters = z.infer<typeof reconciliationQueueSchema>;
export type SummaryRow = Omit<ReconciliationSummary, 'dispatchDate'> & { dispatchDate: Date };

/** All predicates are evaluated by PostgreSQL before LIMIT/OFFSET; never filter a page in JS.
 * State JSON is ordered and contains source identities, so offsetting differences cannot disappear.
 * The token also changes for new QR, sales, returns or reservations without a Dispatch version bump.
 */
export function reconciliationCte(filters: Partial<ReconciliationFilters> = {}, id?: string) {
  return Prisma.sql`WITH candidates AS (
    SELECT d.* FROM erve_dispatches d
    WHERE (${id ?? null}::text IS NULL OR d.id = ${id ?? null})
      AND (${filters.distributorId ?? null}::text IS NULL OR d.distributor_id = ${filters.distributorId ?? null})
      AND (${filters.dispatchReference ?? null}::text IS NULL OR strpos(lower(d.erve_dispatch_number), lower(${filters.dispatchReference ?? null})) > 0)
  ), facts AS (
    SELECT d.id, d.erve_dispatch_number AS "dispatchNumber", d.distributor_id AS "distributorId",
      dist.name AS "distributorName", d.dispatch_date AS "dispatchDate",
      COALESCE(p.quantity, 0)::int AS "dispatchedQuantity", COALESCE(p.cartons, 0)::int AS "cartonCount",
      COALESCE(p.confirmed, 0)::int AS "qrConfirmed", (COALESCE(p.cartons, 0) - COALESCE(p.confirmed, 0))::int AS "qrPending",
      r.id AS "receiptId", r.total_received_quantity AS "receivedQuantity",
      CASE WHEN r.id IS NOT NULL THEN GREATEST(0, COALESCE(p.quantity, 0) - r.total_received_quantity)::int END AS "shortageQuantity",
      l.quantity::int AS "ledgerQuantity", d.delivery_confirmation_source::text AS "ledgerSource",
      r.ledger_disposition::text AS "ledgerDisposition", r.id IS NULL AS "awaitingReceipt",
      (r.id IS NOT NULL AND l.quantity IS NOT NULL AND NOT COALESCE(c.differs, false)) AS "receiptMatchesLedger",
      (r.ledger_disposition = 'EVIDENCE_ONLY_EXISTING' AND COALESCE(c.differs, false)) IS TRUE AS "receiptDiffers",
      (r.total_received_quantity = 0) IS TRUE AS "nothingReceived",
      (r.total_received_quantity < p.quantity) IS TRUE AS "hasShortage",
      (s.state IS NOT NULL OR t.state IS NOT NULL) AS "downstreamActivity",
      md5(jsonb_build_object('version', d.version, 'source', d.delivery_confirmation_source,
        'packing', p.state, 'qr', p.qr, 'receipt', r.id, 'receiptLines', c.state,
        'ledger', l.state, 'sales', s.state, 'returns', t.state)::text) AS "snapshotToken",
      rev.id AS "latestReviewId", rev.action::text AS "latestReviewAction", rev.snapshot_token AS reviewed_token
    FROM candidates d JOIN distributors dist ON dist.id = d.distributor_id
    LEFT JOIN erve_dispatch_distributor_receipts r ON r.erve_dispatch_id = d.id
    LEFT JOIN LATERAL (
      SELECT sum(q.quantity) AS quantity, count(*) AS cartons, count(dc.id) AS confirmed,
        jsonb_agg(jsonb_build_array(fc.id, q.lines) ORDER BY fc.id) AS state,
        jsonb_agg(jsonb_build_array(fc.id, dc.id) ORDER BY fc.id) AS qr
      FROM factory_packing_cartons fc
      JOIN erve_packing_lists pl ON pl.id = fc.erve_packing_list_id AND pl.status = 'DISPATCHED'
      LEFT JOIN carton_delivery_confirmations dc ON dc.carton_id = fc.id AND dc.dispatch_id = d.id
      LEFT JOIN LATERAL (
        SELECT sum(quantity) AS quantity, jsonb_agg(jsonb_build_array(sale_order_line_id, quantity) ORDER BY sale_order_line_id) AS lines
        FROM factory_packing_carton_lines WHERE carton_id = fc.id
      ) q ON true
      WHERE fc.erve_packing_list_id = d.erve_packing_list_id AND fc.retired_at IS NULL
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT sum(received_quantity) AS quantity,
        jsonb_agg(jsonb_build_array(sale_order_line_id, received_quantity) ORDER BY sale_order_line_id) AS state
      FROM erve_dispatch_delivery_lines WHERE erve_dispatch_id = d.id
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT bool_or(x.received_quantity IS DISTINCT FROM y.received_quantity) AS differs,
        jsonb_agg(jsonb_build_array(x.sale_order_line_id, x.received_quantity) ORDER BY x.sale_order_line_id) AS state
      FROM (SELECT * FROM erve_dispatch_distributor_receipt_lines WHERE receipt_id = r.id) x
      FULL JOIN (SELECT * FROM erve_dispatch_delivery_lines WHERE erve_dispatch_id = d.id) y
        ON x.sale_order_line_id = y.sale_order_line_id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_array(id, sale_order_line_id, quantity_sold) ORDER BY id) AS state
      FROM distributor_sales_report_lines WHERE erve_dispatch_id = d.id
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_array(x.id, x.sale_order_line_id, h.status, x.requested_quantity, x.approved_quantity, x.received_quantity) ORDER BY x.id) AS state
      FROM distributor_return_lines x JOIN distributor_returns h ON h.id = x.distributor_return_id WHERE x.erve_dispatch_id = d.id
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT id, action, snapshot_token FROM erve_dispatch_reconciliation_reviews
      WHERE erve_dispatch_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) rev ON true
  ), summaries AS (
    SELECT facts.*, (reviewed_token IS DISTINCT FROM "snapshotToken") AS "pendingReview",
      ("receiptDiffers" OR "hasShortage") AS "followUpRequired" FROM facts
  ), filtered AS (
    SELECT * FROM summaries WHERE
      (${filters.discrepancy ?? null}::boolean IS NULL OR "receiptDiffers" = ${filters.discrepancy ?? null}) AND
      (${filters.shortage ?? null}::boolean IS NULL OR "hasShortage" = ${filters.shortage ?? null}) AND
      (${filters.allZero ?? null}::boolean IS NULL OR "nothingReceived" = ${filters.allZero ?? null}) AND
      (${filters.awaitingReceipt ?? null}::boolean IS NULL OR "awaitingReceipt" = ${filters.awaitingReceipt ?? null}) AND
      (${filters.pendingReview ?? null}::boolean IS NULL OR "pendingReview" = ${filters.pendingReview ?? null})
  )`;
}

export function summaryView(row: SummaryRow): ReconciliationSummary {
  // Do not expose internal query-only state.
  const { reviewed_token: _reviewed, ...rest } = row as SummaryRow & { reviewed_token?: string };
  return { ...rest, dispatchDate: row.dispatchDate.toISOString() };
}
