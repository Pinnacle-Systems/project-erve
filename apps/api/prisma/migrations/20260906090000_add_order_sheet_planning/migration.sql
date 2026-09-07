-- Order Sheet (formerly Purchase Order) Phase 1: Distributor.purchaseMode
-- (authoritative, locked at creation) and DistributorPurchaseOrder.jobOrderId
-- (Order Sheet -> Job Order planning lock, deliberately not @unique so a
-- future Job Order can consolidate multiple Order Sheets).

-- Distributor.purchaseMode: added nullable, backfilled to 'OUTRIGHT' for
-- existing disposable dev rows (NOT a business default going forward --
-- purchaseMode is required on every new Distributor create request), then
-- made required with no column-level default.
ALTER TABLE "distributors" ADD COLUMN "purchaseMode" "PurchaseMode";
UPDATE "distributors" SET "purchaseMode" = 'OUTRIGHT' WHERE "purchaseMode" IS NULL;
ALTER TABLE "distributors" ALTER COLUMN "purchaseMode" SET NOT NULL;

-- DistributorPurchaseOrder.jobOrderId: nullable, indexed, no unique
-- constraint (Phase 2 needs many Order Sheets referencing one Job Order).
ALTER TABLE "distributor_purchase_orders" ADD COLUMN "job_order_id" TEXT;
CREATE INDEX "distributor_purchase_orders_job_order_id_idx" ON "distributor_purchase_orders"("job_order_id");
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Order Sheet exactly-one-style enforcement (DB-level "at most one"; the
-- exactly-one requirement itself is enforced in purchase-orders.validation.ts).
-- No existing duplicate (purchase_order_id) rows found in erve_dev at
-- migration time, so this is a safe direct replacement.
DROP INDEX "distributor_purchase_order_lines_purchase_order_id_style_id_key";
CREATE UNIQUE INDEX "distributor_purchase_order_lines_purchase_order_id_key" ON "distributor_purchase_order_lines"("purchase_order_id");
