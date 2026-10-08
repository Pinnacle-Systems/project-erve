-- CreateEnum
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateTable
CREATE TABLE "tax_invoices" (
    "id" TEXT NOT NULL,
    "status" "TaxInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_number" TEXT,
    "erve_packing_list_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "purchase_mode" "PurchaseMode" NOT NULL,
    "seller_registration_id" TEXT NOT NULL,
    "seller_legal_name" TEXT NOT NULL,
    "seller_trade_name" TEXT,
    "seller_gstin" TEXT NOT NULL,
    "seller_einvoice_applicable" BOOLEAN NOT NULL,
    "seller_address_line1" TEXT NOT NULL,
    "seller_address_line2" TEXT,
    "seller_city" TEXT NOT NULL,
    "seller_state" TEXT NOT NULL,
    "seller_state_code" TEXT NOT NULL,
    "seller_postal_code" TEXT NOT NULL,
    "seller_country" TEXT NOT NULL,
    "seller_bank_name" TEXT NOT NULL,
    "seller_bank_account_name" TEXT NOT NULL,
    "seller_bank_account_number" TEXT NOT NULL,
    "seller_bank_ifsc" TEXT NOT NULL,
    "seller_bank_branch_name" TEXT NOT NULL,
    "seller_bank_address" TEXT,
    "bill_to_name" TEXT NOT NULL,
    "bill_to_gstin" TEXT NOT NULL,
    "bill_to_contact_name" TEXT,
    "bill_to_contact_email" TEXT,
    "bill_to_contact_phone" TEXT,
    "bill_to_address_line1" TEXT,
    "bill_to_address_line2" TEXT,
    "bill_to_city" TEXT,
    "bill_to_state" TEXT,
    "bill_to_country" TEXT,
    "bill_to_postal_code" TEXT,
    "ship_to_label" TEXT,
    "ship_to_contact_name" TEXT,
    "ship_to_contact_email" TEXT,
    "ship_to_contact_phone" TEXT,
    "ship_to_address_line1" TEXT,
    "ship_to_address_line2" TEXT,
    "ship_to_city" TEXT,
    "ship_to_state" TEXT,
    "ship_to_country" TEXT,
    "ship_to_postal_code" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finalized_by_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_invoice_lines" (
    "id" TEXT NOT NULL,
    "tax_invoice_id" TEXT NOT NULL,
    "erve_packing_list_commercial_line_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "style_mrp" DECIMAL(12,2) NOT NULL,
    "distributor_pricing_percentage" DECIMAL(5,2) NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoices_invoice_number_key" ON "tax_invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoices_erve_packing_list_id_key" ON "tax_invoices"("erve_packing_list_id");

-- CreateIndex
CREATE INDEX "tax_invoices_distributor_id_idx" ON "tax_invoices"("distributor_id");

-- CreateIndex
CREATE INDEX "tax_invoices_status_idx" ON "tax_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoice_lines_erve_packing_list_commercial_line_id_key" ON "tax_invoice_lines"("erve_packing_list_commercial_line_id");

-- CreateIndex
CREATE INDEX "tax_invoice_lines_tax_invoice_id_idx" ON "tax_invoice_lines"("tax_invoice_id");

-- CreateIndex
CREATE INDEX "tax_invoice_lines_sale_order_line_id_idx" ON "tax_invoice_lines"("sale_order_line_id");

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_erve_packing_list_id_fkey" FOREIGN KEY ("erve_packing_list_id") REFERENCES "erve_packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_seller_registration_id_fkey" FOREIGN KEY ("seller_registration_id") REFERENCES "seller_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_tax_invoice_id_fkey" FOREIGN KEY ("tax_invoice_id") REFERENCES "tax_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_erve_packing_list_commercial_line_id_fkey" FOREIGN KEY ("erve_packing_list_commercial_line_id") REFERENCES "erve_packing_list_commercial_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
