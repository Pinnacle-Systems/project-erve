-- CreateEnum
CREATE TYPE "TaxInvoiceGstTreatment" AS ENUM ('INTRA', 'INTER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'TAX_INVOICE';

-- AlterTable
ALTER TABLE "tax_invoice_lines" ADD COLUMN     "calculated_unit_rate" DECIMAL(20,6),
ADD COLUMN     "cgst_amount" DECIMAL(29,11),
ADD COLUMN     "final_unit_rate" DECIMAL(20,6),
ADD COLUMN     "gst_percent" DECIMAL(5,2),
ADD COLUMN     "gst_rule_set_version_id" TEXT,
ADD COLUMN     "gst_value_band_id" TEXT,
ADD COLUMN     "hsn_code" TEXT,
ADD COLUMN     "hsn_id" TEXT,
ADD COLUMN     "igst_amount" DECIMAL(29,11),
ADD COLUMN     "overridden_at" TIMESTAMP(3),
ADD COLUMN     "overridden_by_id" TEXT,
ADD COLUMN     "override_reason" TEXT,
ADD COLUMN     "override_unit_rate" DECIMAL(20,6),
ADD COLUMN     "sgst_amount" DECIMAL(29,11),
ADD COLUMN     "taxable_value" DECIMAL(24,6);

-- AlterTable
ALTER TABLE "tax_invoices" ADD COLUMN     "bill_to_state_code" TEXT,
ADD COLUMN     "financial_year_id" TEXT,
ADD COLUMN     "grand_total" DECIMAL(14,2),
ADD COLUMN     "gst_treatment" "TaxInvoiceGstTreatment",
ADD COLUMN     "subtotal" DECIMAL(26,6),
ADD COLUMN     "total_cgst" DECIMAL(31,11),
ADD COLUMN     "total_gst" DECIMAL(31,11),
ADD COLUMN     "total_igst" DECIMAL(31,11),
ADD COLUMN     "total_sgst" DECIMAL(31,11);

-- CreateIndex
CREATE INDEX "tax_invoice_lines_hsn_id_idx" ON "tax_invoice_lines"("hsn_id");

-- CreateIndex
CREATE INDEX "tax_invoices_financial_year_id_idx" ON "tax_invoices"("financial_year_id");

-- AddForeignKey
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_hsn_id_fkey" FOREIGN KEY ("hsn_id") REFERENCES "hsns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_gst_rule_set_version_id_fkey" FOREIGN KEY ("gst_rule_set_version_id") REFERENCES "gst_rule_set_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_gst_value_band_id_fkey" FOREIGN KEY ("gst_value_band_id") REFERENCES "gst_value_bands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_overridden_by_id_fkey" FOREIGN KEY ("overridden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
