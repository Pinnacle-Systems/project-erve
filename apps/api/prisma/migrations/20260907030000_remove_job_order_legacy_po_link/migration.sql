-- Order Sheet Phase 2: remove the legacy singular Job Order -> Order Sheet
-- pointer, add the Job Order's own delivery date, and remove the retired
-- per-Order-Sheet jobOrderedQuantity counter. Historical data does not need
-- preservation (Production has no meaningful Order Sheet/Job Order records
-- — see the Order Sheet Phase 2 plan); this is a direct, destructive drop.

-- DropForeignKey / DropIndex for JobOrder.purchaseOrderId
ALTER TABLE "job_orders" DROP CONSTRAINT "job_orders_purchase_order_id_fkey";
DROP INDEX "job_orders_purchase_order_id_idx";

-- JobOrder.requiredDeliveryDate + drop JobOrder.purchaseOrderId
ALTER TABLE "job_orders" DROP COLUMN "purchase_order_id",
  ADD COLUMN "required_delivery_date" DATE;

-- DistributorPurchaseOrderLineSize.jobOrderedQuantity is checked by a
-- multi-column CHECK constraint (po_line_size_quantities_nonnegative,
-- added in 20260906100000_relax_job_ordered_quantity_cap) — drop and
-- recreate it without the removed column before dropping the column itself.
ALTER TABLE "distributor_purchase_order_line_sizes"
  DROP CONSTRAINT "po_line_size_quantities_nonnegative";

ALTER TABLE "distributor_purchase_order_line_sizes" DROP COLUMN "job_ordered_quantity";

ALTER TABLE "distributor_purchase_order_line_sizes"
  ADD CONSTRAINT "po_line_size_quantities_nonnegative"
  CHECK ("ordered_quantity" >= 0);
