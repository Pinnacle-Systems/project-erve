-- CreateEnum
CREATE TYPE "InvoiceHandoffSourceType" AS ENUM ('OUTRIGHT_DISPATCH', 'SALE_RETURN_SALES_REPORT');

-- CreateEnum
CREATE TYPE "InvoiceHandoffStatus" AS ENUM ('PENDING_TALLY', 'INVOICED');

-- CreateTable
CREATE TABLE "invoice_handoffs" (
    "id" TEXT NOT NULL,
    "source_type" "InvoiceHandoffSourceType" NOT NULL,
    "erve_dispatch_id" TEXT,
    "sale_order_line_id" TEXT,
    "distributor_sales_report_line_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "InvoiceHandoffStatus" NOT NULL DEFAULT 'PENDING_TALLY',
    "tally_invoice_number" TEXT,
    "tally_invoice_date" DATE,
    "tally_voucher_reference" TEXT,
    "remarks" TEXT,
    "recorded_by_id" TEXT,
    "recorded_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_sales_reports" (
    "id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "remarks" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_sales_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributor_sales_report_lines" (
    "id" TEXT NOT NULL,
    "distributor_sales_report_id" TEXT NOT NULL,
    "erve_dispatch_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "quantity_sold" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distributor_sales_report_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_handoffs_distributor_sales_report_line_id_key" ON "invoice_handoffs"("distributor_sales_report_line_id");

-- CreateIndex
CREATE INDEX "invoice_handoffs_status_idx" ON "invoice_handoffs"("status");

-- CreateIndex
CREATE INDEX "invoice_handoffs_source_type_idx" ON "invoice_handoffs"("source_type");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_handoffs_erve_dispatch_id_sale_order_line_id_key" ON "invoice_handoffs"("erve_dispatch_id", "sale_order_line_id");

-- CreateIndex
CREATE INDEX "distributor_sales_reports_distributor_id_idx" ON "distributor_sales_reports"("distributor_id");

-- CreateIndex
CREATE INDEX "distributor_sales_report_lines_distributor_sales_report_id_idx" ON "distributor_sales_report_lines"("distributor_sales_report_id");

-- CreateIndex
CREATE INDEX "distributor_sales_report_lines_erve_dispatch_id_sale_order__idx" ON "distributor_sales_report_lines"("erve_dispatch_id", "sale_order_line_id");

-- AddForeignKey
ALTER TABLE "invoice_handoffs" ADD CONSTRAINT "invoice_handoffs_erve_dispatch_id_fkey" FOREIGN KEY ("erve_dispatch_id") REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_handoffs" ADD CONSTRAINT "invoice_handoffs_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_handoffs" ADD CONSTRAINT "invoice_handoffs_distributor_sales_report_line_id_fkey" FOREIGN KEY ("distributor_sales_report_line_id") REFERENCES "distributor_sales_report_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_handoffs" ADD CONSTRAINT "invoice_handoffs_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales_reports" ADD CONSTRAINT "distributor_sales_reports_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales_reports" ADD CONSTRAINT "distributor_sales_reports_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales_report_lines" ADD CONSTRAINT "distributor_sales_report_lines_distributor_sales_report_id_fkey" FOREIGN KEY ("distributor_sales_report_id") REFERENCES "distributor_sales_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales_report_lines" ADD CONSTRAINT "distributor_sales_report_lines_erve_dispatch_id_fkey" FOREIGN KEY ("erve_dispatch_id") REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributor_sales_report_lines" ADD CONSTRAINT "distributor_sales_report_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
