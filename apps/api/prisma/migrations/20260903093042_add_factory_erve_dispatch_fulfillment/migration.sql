-- CreateEnum
CREATE TYPE "FactoryDispatchStatus" AS ENUM ('DRAFT', 'READY_FOR_ERVE');

-- CreateEnum
CREATE TYPE "ErvePackingListStatus" AS ENUM ('OPEN', 'DISPATCHED');

-- CreateEnum
CREATE TYPE "ErveDispatchStatus" AS ENUM ('DISPATCHED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'FACTORY_DISPATCH';
ALTER TYPE "DocumentType" ADD VALUE 'ERVE_PACKING_LIST';
ALTER TYPE "DocumentType" ADD VALUE 'ERVE_DISPATCH';

-- CreateTable
CREATE TABLE "factory_dispatches" (
    "id" TEXT NOT NULL,
    "factory_dispatch_number" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "status" "FactoryDispatchStatus" NOT NULL DEFAULT 'DRAFT',
    "prepared_by_id" TEXT NOT NULL,
    "prepared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_by_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "financial_year_id" TEXT NOT NULL,
    "factory_dispatch_serial" INTEGER NOT NULL,

    CONSTRAINT "factory_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_dispatch_lines" (
    "id" TEXT NOT NULL,
    "factory_dispatch_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "stock_allocation_id" TEXT NOT NULL,
    "packed_quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_dispatch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_packing_cartons" (
    "id" TEXT NOT NULL,
    "factory_dispatch_id" TEXT NOT NULL,
    "carton_number" TEXT NOT NULL,
    "package_details" TEXT,
    "weight" DECIMAL(10,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_packing_cartons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_packing_carton_lines" (
    "id" TEXT NOT NULL,
    "carton_id" TEXT NOT NULL,
    "factory_dispatch_line_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_packing_carton_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erve_packing_lists" (
    "id" TEXT NOT NULL,
    "erve_packing_list_number" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "status" "ErvePackingListStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "financial_year_id" TEXT NOT NULL,
    "erve_packing_list_serial" INTEGER NOT NULL,

    CONSTRAINT "erve_packing_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erve_packing_list_sources" (
    "id" TEXT NOT NULL,
    "erve_packing_list_id" TEXT NOT NULL,
    "factory_dispatch_id" TEXT NOT NULL,
    "consolidated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erve_packing_list_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erve_dispatches" (
    "id" TEXT NOT NULL,
    "erve_dispatch_number" TEXT NOT NULL,
    "erve_packing_list_id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "status" "ErveDispatchStatus" NOT NULL DEFAULT 'DISPATCHED',
    "dispatch_date" DATE NOT NULL,
    "transporter" TEXT,
    "vehicle_number" TEXT,
    "lr_number" TEXT,
    "remarks" TEXT,
    "dispatched_by_id" TEXT NOT NULL,
    "dispatched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lr_updated_by_id" TEXT,
    "lr_updated_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "financial_year_id" TEXT NOT NULL,
    "erve_dispatch_serial" INTEGER NOT NULL,

    CONSTRAINT "erve_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_dispatches_factory_dispatch_number_key" ON "factory_dispatches"("factory_dispatch_number");

-- CreateIndex
CREATE INDEX "factory_dispatches_factory_id_status_idx" ON "factory_dispatches"("factory_id", "status");

-- CreateIndex
CREATE INDEX "factory_dispatches_sale_order_id_idx" ON "factory_dispatches"("sale_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_dispatches_financial_year_id_factory_dispatch_seria_key" ON "factory_dispatches"("financial_year_id", "factory_dispatch_serial");

-- CreateIndex
CREATE INDEX "factory_dispatch_lines_stock_allocation_id_idx" ON "factory_dispatch_lines"("stock_allocation_id");

-- CreateIndex
CREATE INDEX "factory_dispatch_lines_sale_order_line_id_idx" ON "factory_dispatch_lines"("sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_dispatch_line_allocation_key" ON "factory_dispatch_lines"("factory_dispatch_id", "stock_allocation_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_packing_cartons_factory_dispatch_id_carton_number_key" ON "factory_packing_cartons"("factory_dispatch_id", "carton_number");

-- CreateIndex
CREATE INDEX "factory_packing_carton_lines_factory_dispatch_line_id_idx" ON "factory_packing_carton_lines"("factory_dispatch_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_packing_carton_lines_carton_id_factory_dispatch_lin_key" ON "factory_packing_carton_lines"("carton_id", "factory_dispatch_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "erve_packing_lists_erve_packing_list_number_key" ON "erve_packing_lists"("erve_packing_list_number");

-- CreateIndex
CREATE INDEX "erve_packing_lists_sale_order_id_status_idx" ON "erve_packing_lists"("sale_order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erve_packing_lists_financial_year_id_erve_packing_list_seri_key" ON "erve_packing_lists"("financial_year_id", "erve_packing_list_serial");

-- CreateIndex
CREATE UNIQUE INDEX "erve_packing_list_sources_factory_dispatch_id_key" ON "erve_packing_list_sources"("factory_dispatch_id");

-- CreateIndex
CREATE INDEX "erve_packing_list_sources_erve_packing_list_id_idx" ON "erve_packing_list_sources"("erve_packing_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "erve_dispatches_erve_dispatch_number_key" ON "erve_dispatches"("erve_dispatch_number");

-- CreateIndex
CREATE UNIQUE INDEX "erve_dispatches_erve_packing_list_id_key" ON "erve_dispatches"("erve_packing_list_id");

-- CreateIndex
CREATE INDEX "erve_dispatches_sale_order_id_idx" ON "erve_dispatches"("sale_order_id");

-- CreateIndex
CREATE INDEX "erve_dispatches_distributor_id_idx" ON "erve_dispatches"("distributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "erve_dispatches_financial_year_id_erve_dispatch_serial_key" ON "erve_dispatches"("financial_year_id", "erve_dispatch_serial");

-- AddForeignKey
ALTER TABLE "factory_dispatches" ADD CONSTRAINT "factory_dispatches_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatches" ADD CONSTRAINT "factory_dispatches_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatches" ADD CONSTRAINT "factory_dispatches_prepared_by_id_fkey" FOREIGN KEY ("prepared_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatches" ADD CONSTRAINT "factory_dispatches_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatches" ADD CONSTRAINT "factory_dispatches_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatch_lines" ADD CONSTRAINT "factory_dispatch_lines_factory_dispatch_id_fkey" FOREIGN KEY ("factory_dispatch_id") REFERENCES "factory_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatch_lines" ADD CONSTRAINT "factory_dispatch_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_dispatch_lines" ADD CONSTRAINT "factory_dispatch_lines_stock_allocation_id_fkey" FOREIGN KEY ("stock_allocation_id") REFERENCES "stock_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_cartons" ADD CONSTRAINT "factory_packing_cartons_factory_dispatch_id_fkey" FOREIGN KEY ("factory_dispatch_id") REFERENCES "factory_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_carton_lines" ADD CONSTRAINT "factory_packing_carton_lines_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "factory_packing_cartons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_carton_lines" ADD CONSTRAINT "factory_packing_carton_lines_factory_dispatch_line_id_fkey" FOREIGN KEY ("factory_dispatch_line_id") REFERENCES "factory_dispatch_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_list_sources" ADD CONSTRAINT "erve_packing_list_sources_erve_packing_list_id_fkey" FOREIGN KEY ("erve_packing_list_id") REFERENCES "erve_packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_list_sources" ADD CONSTRAINT "erve_packing_list_sources_factory_dispatch_id_fkey" FOREIGN KEY ("factory_dispatch_id") REFERENCES "factory_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_erve_packing_list_id_fkey" FOREIGN KEY ("erve_packing_list_id") REFERENCES "erve_packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_dispatched_by_id_fkey" FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_lr_updated_by_id_fkey" FOREIGN KEY ("lr_updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
