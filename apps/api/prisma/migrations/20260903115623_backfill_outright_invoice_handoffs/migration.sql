-- Backfill: every ErveDispatch recorded before the InvoiceHandoff model
-- existed gets its OUTRIGHT-sourced quantity (summed per SaleOrderLine,
-- traced through the COMMERCIAL chain — SaleOrderLine -> PO line/size -> PO
-- line -> DistributorPurchaseOrder.purchaseMode, never through the physical
-- StockAllocation/QaReleaseLine provenance) turned into a PENDING_TALLY
-- InvoiceHandoff, matching what recordErveDispatch creates automatically
-- going forward. SALE_RETURN-sourced quantity deliberately gets nothing —
-- it only becomes invoiceable once a Distributor Sales Report line exists,
-- and none can exist yet for historical dispatches. No Tally reference is
-- fabricated.
INSERT INTO "invoice_handoffs" (
  "id", "source_type", "erve_dispatch_id", "sale_order_line_id", "quantity", "status", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'OUTRIGHT_DISPATCH',
  ed."id",
  fdl."sale_order_line_id",
  SUM(fdl."packed_quantity")::int,
  'PENDING_TALLY',
  now(),
  now()
FROM "factory_dispatch_lines" fdl
JOIN "erve_packing_list_sources" epls ON epls."factory_dispatch_id" = fdl."factory_dispatch_id"
JOIN "erve_dispatches" ed ON ed."erve_packing_list_id" = epls."erve_packing_list_id"
JOIN "sale_order_lines" sol ON sol."id" = fdl."sale_order_line_id"
JOIN "distributor_purchase_order_line_sizes" pols ON pols."id" = sol."purchase_order_line_size_id"
JOIN "distributor_purchase_order_lines" pol ON pol."id" = pols."purchase_order_line_id"
JOIN "distributor_purchase_orders" po ON po."id" = pol."purchase_order_id"
WHERE po."purchase_mode" = 'OUTRIGHT'
  AND NOT EXISTS (
    SELECT 1 FROM "invoice_handoffs" ih
    WHERE ih."erve_dispatch_id" = ed."id" AND ih."sale_order_line_id" = fdl."sale_order_line_id"
  )
GROUP BY ed."id", fdl."sale_order_line_id";
