-- INV-009A: Tax Invoice cancellation and replacement workflow.
-- Allows an EIPL to have multiple historical cancelled Tax Invoices and at most
-- one non-cancelled (active) Tax Invoice. Enables replacement invoices to reference
-- the same EIPL and its commercial lines while preserving the complete history of
-- cancelled invoices and their immutable snapshots.

-- 1. Extend TaxInvoiceStatus enum with CANCELLED
ALTER TYPE "TaxInvoiceStatus" ADD VALUE 'CANCELLED';

-- 2. Drop unconditional uniqueness on TaxInvoice.erve_packing_list_id
DROP INDEX IF EXISTS "tax_invoices_erve_packing_list_id_key";

-- 3. Enforce at most one active (non-cancelled) Tax Invoice per EIPL
CREATE UNIQUE INDEX "tax_invoice_active_eipl_unique"
ON "tax_invoices" ("erve_packing_list_id")
WHERE "status" <> 'CANCELLED';

-- 4. Drop unconditional uniqueness on TaxInvoiceLine.erve_packing_list_commercial_line_id
DROP INDEX IF EXISTS "tax_invoice_lines_erve_packing_list_commercial_line_id_key";

-- 5. Enforce unique commercial line per Tax Invoice (permits replacement invoices to reference the same commercial line)
CREATE UNIQUE INDEX "tax_invoice_lines_tax_invoice_id_erve_packing_list_commercial_line_id_key"
ON "tax_invoice_lines" ("tax_invoice_id", "erve_packing_list_commercial_line_id");

-- 6. Add cancellation metadata and replacement provenance columns
ALTER TABLE "tax_invoices"
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_by_id" TEXT,
  ADD COLUMN "cancellation_reason" TEXT,
  ADD COLUMN "replaces_invoice_id" TEXT;

-- 7. Add foreign key constraints
ALTER TABLE "tax_invoices"
  ADD CONSTRAINT "tax_invoices_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tax_invoices"
  ADD CONSTRAINT "tax_invoices_replaces_invoice_id_fkey"
  FOREIGN KEY ("replaces_invoice_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. Add lookup indexes
CREATE INDEX "tax_invoices_erve_packing_list_id_idx" ON "tax_invoices"("erve_packing_list_id");
CREATE INDEX "tax_invoices_replaces_invoice_id_idx" ON "tax_invoices"("replaces_invoice_id");
