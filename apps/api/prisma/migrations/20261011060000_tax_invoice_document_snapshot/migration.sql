-- Nullable, additive, no backfill or issued-document rewrite.
ALTER TABLE "tax_invoices" ADD COLUMN "document_snapshot" JSONB;
