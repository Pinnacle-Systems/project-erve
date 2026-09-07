-- Order Sheet Phase 1: Job Order quantities are independent of the Order
-- Sheet's forecast (pre-filled as a default, freely editable up or down, no
-- remaining-balance cap — see job-orders.service.ts createJobOrderFromPO).
-- The old constraint enforced job_ordered_quantity <= ordered_quantity,
-- which encoded the retired partial-allocation/remaining-balance model.
-- jobOrderedQuantity remains informational only; non-negativity is kept.
ALTER TABLE "distributor_purchase_order_line_sizes"
  DROP CONSTRAINT "po_line_size_quantities_nonnegative";

ALTER TABLE "distributor_purchase_order_line_sizes"
  ADD CONSTRAINT "po_line_size_quantities_nonnegative"
  CHECK (
    "ordered_quantity" >= 0 AND
    "job_ordered_quantity" >= 0
  );
