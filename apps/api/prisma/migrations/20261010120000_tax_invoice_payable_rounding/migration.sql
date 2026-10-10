-- PR0: additive nullable snapshots, with no defaults or data backfill.
-- Previously finalized documents retain their issued financial values.
ALTER TABLE "tax_invoices"
ADD COLUMN "payable_total" DECIMAL(14,2),
ADD COLUMN "round_off_adjustment" DECIMAL(14,2),
ADD COLUMN "rounding_policy" TEXT;
