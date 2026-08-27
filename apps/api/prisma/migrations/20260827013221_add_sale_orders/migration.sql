-- CreateEnum
CREATE TYPE "SaleOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockAllocationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "StockAllocationSource" AS ENUM ('DISTRIBUTOR_REQUEST', 'MERCHANDISER_ADJUSTMENT', 'MERCHANDISER_REASSIGNMENT');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SALE_ORDER';

-- CreateTable
CREATE TABLE "sale_orders" (
    "id" TEXT NOT NULL,
    "sale_order_number" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "so_date" DATE NOT NULL,
    "status" "SaleOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "financial_year_id" TEXT NOT NULL,
    "so_serial" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_order_lines" (
    "id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "purchase_order_line_size_id" TEXT NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "approved_quantity" INTEGER,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_allocations" (
    "id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "qa_release_line_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocation_source" "StockAllocationSource" NOT NULL,
    "reason" TEXT,
    "allocated_by_id" TEXT NOT NULL,
    "released_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_order_idempotency_records" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "result_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_order_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_sale_order_number_key" ON "sale_orders"("sale_order_number");

-- CreateIndex
CREATE INDEX "sale_orders_distributor_id_idx" ON "sale_orders"("distributor_id");

-- CreateIndex
CREATE INDEX "sale_orders_status_idx" ON "sale_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_financial_year_id_so_serial_key" ON "sale_orders"("financial_year_id", "so_serial");

-- CreateIndex
CREATE INDEX "sale_order_lines_sale_order_id_idx" ON "sale_order_lines"("sale_order_id");

-- CreateIndex
CREATE INDEX "sale_order_lines_purchase_order_line_size_id_idx" ON "sale_order_lines"("purchase_order_line_size_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_order_line_size_key" ON "sale_order_lines"("sale_order_id", "purchase_order_line_size_id");

-- CreateIndex
CREATE INDEX "stock_allocation_release_status_idx" ON "stock_allocations"("qa_release_line_id", "status");

-- CreateIndex
CREATE INDEX "stock_allocations_sale_order_line_id_status_idx" ON "stock_allocations"("sale_order_line_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_allocation_line_release_key" ON "stock_allocations"("sale_order_line_id", "qa_release_line_id");

-- CreateIndex
CREATE INDEX "sale_order_idempotency_records_sale_order_id_idx" ON "sale_order_idempotency_records"("sale_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_order_idempotency_records_actor_op_key" ON "sale_order_idempotency_records"("actor_id", "operation", "idempotency_key");

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_purchase_order_line_size_id_fkey" FOREIGN KEY ("purchase_order_line_size_id") REFERENCES "distributor_purchase_order_line_sizes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_qa_release_line_id_fkey" FOREIGN KEY ("qa_release_line_id") REFERENCES "qa_release_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_allocated_by_id_fkey" FOREIGN KEY ("allocated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_allocations" ADD CONSTRAINT "stock_allocations_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sale_order_idempotency_records" ADD CONSTRAINT "sale_order_idempotency_records_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
