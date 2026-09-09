-- CreateEnum
CREATE TYPE "FactoryInvoiceStatus" AS ENUM ('GENERATED', 'FACTORY_CONFIRMED', 'FINALIZED');

-- CreateTable
CREATE TABLE "factory_invoices" (
    "id" TEXT NOT NULL,
    "factory_dispatch_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "status" "FactoryInvoiceStatus" NOT NULL DEFAULT 'GENERATED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "factory_confirmed_by_id" TEXT,
    "factory_confirmed_at" TIMESTAMP(3),
    "finalized_by_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_invoice_lines" (
    "id" TEXT NOT NULL,
    "factory_invoice_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "default_rate" DECIMAL(12,2) NOT NULL,
    "unit_rate" DECIMAL(12,2) NOT NULL,
    "line_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_invoices_factory_dispatch_id_key" ON "factory_invoices"("factory_dispatch_id");

-- CreateIndex
CREATE INDEX "factory_invoices_factory_id_status_idx" ON "factory_invoices"("factory_id", "status");

-- CreateIndex
CREATE INDEX "factory_invoice_lines_sale_order_line_id_idx" ON "factory_invoice_lines"("sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_invoice_lines_factory_invoice_id_sale_order_line_id_key" ON "factory_invoice_lines"("factory_invoice_id", "sale_order_line_id");

-- AddForeignKey
ALTER TABLE "factory_invoices" ADD CONSTRAINT "factory_invoices_factory_dispatch_id_fkey" FOREIGN KEY ("factory_dispatch_id") REFERENCES "factory_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_invoices" ADD CONSTRAINT "factory_invoices_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_invoices" ADD CONSTRAINT "factory_invoices_factory_confirmed_by_id_fkey" FOREIGN KEY ("factory_confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_invoices" ADD CONSTRAINT "factory_invoices_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_invoice_lines" ADD CONSTRAINT "factory_invoice_lines_factory_invoice_id_fkey" FOREIGN KEY ("factory_invoice_id") REFERENCES "factory_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_invoice_lines" ADD CONSTRAINT "factory_invoice_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
