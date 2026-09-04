-- Corrective backfill: the prior backfill (20260903115623) only created
-- InvoiceHandoff rows for OUTRIGHT-sourced dispatched lines, matching the
-- since-corrected "SALE_RETURN dispatch creates no handoff" assumption. Per
-- the corrected "Dispatch Sale" semantics, EVERY physically dispatched
-- quantity — both Purchase Modes — gets a PENDING_TALLY handoff the moment
-- it was dispatched. This inserts the missing SALE_RETURN rows for existing
-- ErveDispatch history (skipping any (erveDispatchId, saleOrderLineId) pair
-- that already has a row, so the earlier OUTRIGHT backfill is untouched).
-- No Tally reference is fabricated.
INSERT INTO "invoice_handoffs" ("id", "erve_dispatch_id", "sale_order_line_id", "quantity", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  ed."id",
  fdl."sale_order_line_id",
  SUM(fdl."packed_quantity")::int,
  'PENDING_TALLY',
  now(),
  now()
FROM "factory_dispatch_lines" fdl
JOIN "erve_packing_list_sources" epls ON epls."factory_dispatch_id" = fdl."factory_dispatch_id"
JOIN "erve_dispatches" ed ON ed."erve_packing_list_id" = epls."erve_packing_list_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "invoice_handoffs" ih
  WHERE ih."erve_dispatch_id" = ed."id" AND ih."sale_order_line_id" = fdl."sale_order_line_id"
)
GROUP BY ed."id", fdl."sale_order_line_id";
