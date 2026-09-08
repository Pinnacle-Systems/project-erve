-- Phase 2.1: validate_qa_release_line_identity() (added in
-- 20260824130000_add_final_batch_release_accounting) still checked
-- s."purchase_order_line_size_id" = NEW."purchase_order_line_size_id" —
-- job_order_line_sizes.purchase_order_line_size_id was dropped by
-- 20260907040000_job_order_production_plan_decoupling, so every QA-release
-- write started failing with "column s.purchase_order_line_size_id does not
-- exist". QaReleaseLine.purchaseOrderLineSizeId is now an independent,
-- optional legacy Sale Order compatibility value resolved by application
-- logic (see quality-executions.service.ts
-- resolveLegacyPurchaseOrderLineSizeIds) — it can no longer be derived from
-- or cross-checked against the JobOrderLineSize row, so that half of the
-- check is removed. The remaining identity check (the release line's
-- JobOrderLineSize must belong to the same Job Order as its QaRelease)
-- stays exactly as before.
CREATE OR REPLACE FUNCTION validate_qa_release_line_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "qa_releases" r
    JOIN "job_order_line_sizes" s ON s."id" = NEW."job_order_line_size_id"
    JOIN "job_order_lines" l ON l."id" = s."job_order_line_id"
    WHERE r."id" = NEW."qa_release_id"
      AND l."job_order_id" = r."job_order_id"
  ) THEN
    RAISE EXCEPTION 'QA release line does not match its Job Order size' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
