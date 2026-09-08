-- Dispatch Order Phase 3: Sale Order becomes the pooled-Factory+Style+Size
-- allocation "Dispatch Order". Removes the old draft/submit/review/approve
-- workflow status values and the legacy per-Order-Sheet allocation bridge
-- (QaReleaseLine.purchaseOrderLineSizeId, DistributorPurchaseOrderLineSize
-- .qaPassedQuantity); replaces SaleOrderLine's purchase-order-line-size
-- identity with a direct destination + style + size + quantity grain; adds
-- SaleOrder.factoryId (one Factory per Dispatch Order) and the new
-- SaleOrderDestination address-snapshot table; and establishes one
-- FactoryDispatch packing root per Dispatch Order.
--
-- Dev/test only. Disposable Sale-Order-chain transactional data
-- (sale_orders/sale_order_lines/stock_allocations/idempotency records) was
-- cleared from erve_dev before this migration was generated, per the
-- approved Phase 3 plan's migration strategy (historical transactional Sale
-- Order/fulfilment data is disposable) — this migration was NOT written to
-- backfill/preserve that data.
-- AlterEnum
BEGIN;
CREATE TYPE "SaleOrderStatus_new" AS ENUM ('ACTIVE');
ALTER TABLE "public"."sale_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sale_orders" ALTER COLUMN "status" TYPE "SaleOrderStatus_new" USING ("status"::text::"SaleOrderStatus_new");
ALTER TYPE "SaleOrderStatus" RENAME TO "SaleOrderStatus_old";
ALTER TYPE "SaleOrderStatus_new" RENAME TO "SaleOrderStatus";
DROP TYPE "public"."SaleOrderStatus_old";
ALTER TABLE "sale_orders" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "StockAllocationSource_new" AS ENUM ('MERCHANDISER_ALLOCATION');
ALTER TABLE "stock_allocations" ALTER COLUMN "allocation_source" TYPE "StockAllocationSource_new" USING ("allocation_source"::text::"StockAllocationSource_new");
ALTER TYPE "StockAllocationSource" RENAME TO "StockAllocationSource_old";
ALTER TYPE "StockAllocationSource_new" RENAME TO "StockAllocationSource";
DROP TYPE "public"."StockAllocationSource_old";
COMMIT;

-- Raw-SQL live-object sweep (Dispatch Order Phase 3): the live
-- "qa_release_line_identity_guard" trigger (originally created in
-- 20260824130000_add_final_batch_release_accounting; its function body was
-- already fixed in 20260908000000_fix_qa_release_line_identity_trigger, but
-- the TRIGGER's own "UPDATE OF" column-list was never recreated and still
-- names purchase_order_line_size_id) must be dropped and recreated without
-- that column before it can be dropped from qa_release_lines below. No
-- other live function/trigger/view in this repo references any column or
-- enum value removed by this migration (verified by inspecting every
-- CREATE FUNCTION/CREATE TRIGGER across prisma/migrations/*/migration.sql).
DROP TRIGGER "qa_release_line_identity_guard" ON "qa_release_lines";
CREATE TRIGGER "qa_release_line_identity_guard"
BEFORE INSERT OR UPDATE OF "qa_release_id", "job_order_line_size_id"
ON "qa_release_lines" FOR EACH ROW EXECUTE FUNCTION validate_qa_release_line_identity();

-- DropForeignKey
ALTER TABLE "qa_release_lines" DROP CONSTRAINT "qa_release_lines_purchase_order_line_size_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_order_lines" DROP CONSTRAINT "sale_order_lines_purchase_order_line_size_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_orders" DROP CONSTRAINT "sale_orders_fulfilled_by_id_fkey";

-- DropForeignKey
ALTER TABLE "sale_orders" DROP CONSTRAINT "sale_orders_reviewed_by_id_fkey";

-- DropIndex
DROP INDEX "factory_dispatches_sale_order_id_idx";

-- DropIndex
DROP INDEX "qa_release_line_po_size_idx";

-- DropIndex
DROP INDEX "sale_order_line_size_key";

-- DropIndex
DROP INDEX "sale_order_lines_purchase_order_line_size_id_idx";

-- AlterTable
ALTER TABLE "distributor_purchase_order_line_sizes" DROP COLUMN "qa_passed_quantity";

-- AlterTable
ALTER TABLE "qa_release_lines" DROP COLUMN "purchase_order_line_size_id";

-- AlterTable
ALTER TABLE "sale_order_lines" DROP COLUMN "approved_quantity",
DROP COLUMN "purchase_order_line_size_id",
DROP COLUMN "requested_quantity",
ADD COLUMN     "destination_id" TEXT NOT NULL,
ADD COLUMN     "quantity" INTEGER NOT NULL,
ADD COLUMN     "size_id" TEXT NOT NULL,
ADD COLUMN     "style_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sale_orders" DROP COLUMN "decision_reason",
DROP COLUMN "fulfilled_at",
DROP COLUMN "fulfilled_by_id",
DROP COLUMN "fulfillment_reference",
DROP COLUMN "reviewed_at",
DROP COLUMN "reviewed_by_id",
DROP COLUMN "submitted_at",
ADD COLUMN     "factory_id" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "sale_order_destinations" (
    "id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "label" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "postal_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_order_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_order_destinations_sale_order_id_idx" ON "sale_order_destinations"("sale_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_dispatch_one_root_per_sale_order_key" ON "factory_dispatches"("sale_order_id");

-- CreateIndex
CREATE INDEX "sale_order_lines_destination_id_idx" ON "sale_order_lines"("destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_order_line_grain_key" ON "sale_order_lines"("sale_order_id", "destination_id", "style_id", "size_id");

-- CreateIndex
CREATE INDEX "sale_orders_factory_id_idx" ON "sale_orders"("factory_id");

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_destinations" ADD CONSTRAINT "sale_order_destinations_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "sale_order_destinations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

