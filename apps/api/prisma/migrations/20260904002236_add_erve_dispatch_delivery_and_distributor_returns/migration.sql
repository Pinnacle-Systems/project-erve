-- CreateEnum
CREATE TYPE "DeliveryConfirmationSource" AS ENUM ('USER_CONFIRMED', 'LEGACY_ASSUMED_FULL_RECEIPT');

-- CreateEnum
CREATE TYPE "DistributorReturnStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DISTRIBUTOR_RETURN';

-- AlterEnum
ALTER TYPE "ErveDispatchStatus" ADD VALUE 'DELIVERED';

-- AlterTable
ALTER TABLE "erve_dispatches" ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivered_by_id" TEXT,
ADD COLUMN     "delivery_confirmation_source" "DeliveryConfirmationSource",
ADD COLUMN     "delivery_remarks" TEXT;

-- CreateTable
CREATE TABLE "erve_dispatch_delivery_lines" (
    "id" TEXT NOT NULL,
    "erve_dispatch_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "received_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erve_dispatch_delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_returns" (
    "id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "return_date" DATE NOT NULL,
    "status" "DistributorReturnStatus" NOT NULL DEFAULT 'SUBMITTED',
    "return_reason" TEXT NOT NULL,
    "remarks" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_remarks" TEXT,
    "rejection_reason" TEXT,
    "received_by_id" TEXT,
    "received_at" TIMESTAMP(3),
    "credit_note_reference" TEXT,
    "credit_note_date" DATE,
    "credit_note_recorded_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "financial_year_id" TEXT NOT NULL,
    "return_serial" INTEGER NOT NULL,

    CONSTRAINT "distributor_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_return_lines" (
    "id" TEXT NOT NULL,
    "distributor_return_id" TEXT NOT NULL,
    "erve_dispatch_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "approved_quantity" INTEGER,
    "received_quantity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returned_stock_lots" (
    "id" TEXT NOT NULL,
    "distributor_return_line_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returned_stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erve_dispatch_delivery_lines_sale_order_line_id_idx" ON "erve_dispatch_delivery_lines"("sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "erve_dispatch_delivery_lines_erve_dispatch_id_sale_order_li_key" ON "erve_dispatch_delivery_lines"("erve_dispatch_id", "sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_returns_return_number_key" ON "distributor_returns"("return_number");

-- CreateIndex
CREATE INDEX "distributor_returns_distributor_id_idx" ON "distributor_returns"("distributor_id");

-- CreateIndex
CREATE INDEX "distributor_returns_status_idx" ON "distributor_returns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_returns_financial_year_id_return_serial_key" ON "distributor_returns"("financial_year_id", "return_serial");

-- CreateIndex
CREATE INDEX "distributor_return_lines_erve_dispatch_id_sale_order_line_i_idx" ON "distributor_return_lines"("erve_dispatch_id", "sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributor_return_lines_distributor_return_id_erve_dispatc_key" ON "distributor_return_lines"("distributor_return_id", "erve_dispatch_id", "sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "returned_stock_lots_distributor_return_line_id_key" ON "returned_stock_lots"("distributor_return_line_id");

-- CreateIndex
CREATE INDEX "returned_stock_lots_sale_order_line_id_idx" ON "returned_stock_lots"("sale_order_line_id");

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_delivered_by_id_fkey" FOREIGN KEY ("delivered_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatch_delivery_lines" ADD CONSTRAINT "erve_dispatch_delivery_lines_erve_dispatch_id_fkey" FOREIGN KEY ("erve_dispatch_id") REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatch_delivery_lines" ADD CONSTRAINT "erve_dispatch_delivery_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_credit_note_recorded_by_id_fkey" FOREIGN KEY ("credit_note_recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_returns" ADD CONSTRAINT "distributor_returns_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_return_lines" ADD CONSTRAINT "distributor_return_lines_distributor_return_id_fkey" FOREIGN KEY ("distributor_return_id") REFERENCES "distributor_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_return_lines" ADD CONSTRAINT "distributor_return_lines_erve_dispatch_id_fkey" FOREIGN KEY ("erve_dispatch_id") REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_return_lines" ADD CONSTRAINT "distributor_return_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returned_stock_lots" ADD CONSTRAINT "returned_stock_lots_distributor_return_line_id_fkey" FOREIGN KEY ("distributor_return_line_id") REFERENCES "distributor_return_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returned_stock_lots" ADD CONSTRAINT "returned_stock_lots_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
