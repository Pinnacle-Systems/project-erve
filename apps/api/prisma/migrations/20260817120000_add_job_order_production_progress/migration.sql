ALTER TABLE "job_order_stage_statuses"
  ADD COLUMN "completed_quantity" INTEGER;

ALTER TABLE "job_order_stage_statuses"
  ADD CONSTRAINT "job_order_stage_statuses_completed_quantity_nonnegative"
  CHECK ("completed_quantity" >= 0);

-- Existing rows intentionally remain NULL: their historical quantity was not
-- captured. Newly created runtime rows explicitly start at actual zero.
-- The upper bound is enforced transactionally against the Job Order's derived
-- ordered total; PostgreSQL CHECK constraints cannot reference the parent rows.

CREATE FUNCTION "enforce_job_order_production_runtime_definition"()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "job_orders" jo
    JOIN "process_flow_version_stages" activity
      ON activity."process_flow_version_id" = jo."process_flow_version_id"
    WHERE jo."id" = NEW."job_order_id"
      AND activity."id" = NEW."process_flow_version_stage_id"
      AND activity."activity_type" = 'PRODUCTION'
  ) THEN
    RAISE EXCEPTION 'Job Order Production runtime must reference a Production activity from its assigned Process Flow version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "job_order_production_runtime_definition_guard"
BEFORE INSERT OR UPDATE OF "job_order_id", "process_flow_version_stage_id"
ON "job_order_stage_statuses"
FOR EACH ROW EXECUTE FUNCTION "enforce_job_order_production_runtime_definition"();
