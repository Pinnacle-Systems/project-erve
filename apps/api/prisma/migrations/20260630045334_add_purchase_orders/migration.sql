-- CreateEnum
CREATE TYPE "PurchaseMode" AS ENUM ('OUTRIGHT', 'SALE_RETURN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'PARTIALLY_JOB_ORDERED', 'FULLY_JOB_ORDERED', 'PARTIALLY_FULFILLED', 'FULLY_FULFILLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderLineStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "distributor_purchase_orders" (
    "id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "merchandiser_id" TEXT,
    "po_date" DATE NOT NULL,
    "required_delivery_date" DATE,
    "purchase_mode" "PurchaseMode" NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributor_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "line_status" "PurchaseOrderLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributor_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_purchase_order_line_sizes" (
    "id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "job_ordered_quantity" INTEGER NOT NULL DEFAULT 0,
    "qa_passed_quantity" INTEGER NOT NULL DEFAULT 0,
    "sale_ordered_quantity" INTEGER NOT NULL DEFAULT 0,
    "dispatched_quantity" INTEGER NOT NULL DEFAULT 0,
    "delivered_quantity" INTEGER NOT NULL DEFAULT 0,
    "actual_sold_quantity" INTEGER NOT NULL DEFAULT 0,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "reassigned_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributor_purchase_order_line_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distributor_purchase_orders_po_number_key" ON "distributor_purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "distributor_purchase_orders_distributor_id_idx" ON "distributor_purchase_orders"("distributor_id");

-- CreateIndex
CREATE INDEX "distributor_purchase_orders_status_idx" ON "distributor_purchase_orders"("status");

-- CreateIndex
CREATE INDEX "distributor_purchase_orders_po_date_idx" ON "distributor_purchase_orders"("po_date");

-- CreateIndex
CREATE INDEX "distributor_purchase_order_lines_purchase_order_id_idx" ON "distributor_purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "distributor_purchase_order_lines_style_id_idx" ON "distributor_purchase_order_lines"("style_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_purchase_order_lines_purchase_order_id_style_id_key" ON "distributor_purchase_order_lines"("purchase_order_id", "style_id");

-- CreateIndex
CREATE INDEX "distributor_purchase_order_line_sizes_purchase_order_line_i_idx" ON "distributor_purchase_order_line_sizes"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "distributor_purchase_order_line_sizes_size_id_idx" ON "distributor_purchase_order_line_sizes"("size_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_purchase_order_line_sizes_purchase_order_line_i_key" ON "distributor_purchase_order_line_sizes"("purchase_order_line_id", "size_id");

-- AddForeignKey
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_merchandiser_id_fkey" FOREIGN KEY ("merchandiser_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_order_lines" ADD CONSTRAINT "distributor_purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "distributor_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_order_lines" ADD CONSTRAINT "distributor_purchase_order_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_order_line_sizes" ADD CONSTRAINT "distributor_purchase_order_line_sizes_purchase_order_line__fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "distributor_purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_purchase_order_line_sizes" ADD CONSTRAINT "distributor_purchase_order_line_sizes_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
