-- Backfill: every ErveDispatch recorded before delivery confirmation existed
-- gets one ErveDispatchDeliveryLine per SaleOrderLine at
-- receivedQuantity = dispatchedQuantity (summed FactoryDispatchLine.packed_quantity,
-- same grouping the invoice-handoff backfill already uses), so existing
-- DistributorSalesReport rows against these dispatches remain valid under
-- the new received-quantity ceiling. This is NOT a confirmed delivery fact —
-- deliveryConfirmationSource is tagged LEGACY_ASSUMED_FULL_RECEIPT (never
-- USER_CONFIRMED) and delivered_by_id/delivered_at are deliberately left
-- NULL: we don't know who confirmed receipt for these historical rows, or
-- when, only that we're assuming full receipt for compatibility. A real
-- confirmErveDispatchDelivery call always writes USER_CONFIRMED with a real
-- actor/timestamp. Idempotent: only inserts delivery lines where none exist
-- yet and only flips dispatches still in DISPATCHED status, so a retried or
-- partially-applied run cannot duplicate rows or clobber a real confirmation
-- that happened to land in between.

INSERT INTO "erve_dispatch_delivery_lines" (
  "id", "erve_dispatch_id", "sale_order_line_id", "received_quantity", "created_at"
)
SELECT
  gen_random_uuid()::text,
  ed."id",
  fdl."sale_order_line_id",
  SUM(fdl."packed_quantity")::int,
  now()
FROM "erve_dispatches" ed
JOIN "erve_packing_list_sources" epls ON epls."erve_packing_list_id" = ed."erve_packing_list_id"
JOIN "factory_dispatch_lines" fdl ON fdl."factory_dispatch_id" = epls."factory_dispatch_id"
WHERE ed."status" = 'DISPATCHED'
  AND NOT EXISTS (
    SELECT 1 FROM "erve_dispatch_delivery_lines" edl
    WHERE edl."erve_dispatch_id" = ed."id" AND edl."sale_order_line_id" = fdl."sale_order_line_id"
  )
GROUP BY ed."id", fdl."sale_order_line_id";

UPDATE "erve_dispatches"
SET "status" = 'DELIVERED',
    "delivery_confirmation_source" = 'LEGACY_ASSUMED_FULL_RECEIPT'
WHERE "status" = 'DISPATCHED';
