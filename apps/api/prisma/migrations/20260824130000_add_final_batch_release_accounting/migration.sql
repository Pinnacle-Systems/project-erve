CREATE TYPE "FinalQualityBatchDisposition" AS ENUM ('DRAFT', 'AWAITING_REINSPECTION', 'RELEASED', 'PERMANENTLY_REJECTED', 'CANCELLED');
ALTER TABLE "quality_activity_executions" DROP CONSTRAINT "quality_execution_finalize_consistent";
ALTER TABLE "quality_activity_executions" ADD CONSTRAINT "quality_execution_finalize_consistent" CHECK (
  ("status" IN ('DRAFT', 'CANCELLED') AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL) OR
  ("status" = 'FINALIZED' AND "finalized_at" IS NOT NULL AND "finalized_by_id" IS NOT NULL)
);

ALTER TABLE "job_order_line_sizes"
  ADD CONSTRAINT "job_order_line_size_prepared_within_ordered"
  CHECK ("prepared_quantity" >= 0 AND "prepared_quantity" <= "ordered_quantity");

CREATE TABLE "final_quality_batches" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL,
  "process_flow_activity_id" TEXT NOT NULL,
  "batch_number" INTEGER NOT NULL,
  "physical_quantity" INTEGER NOT NULL,
  "disposition" "FinalQualityBatchDisposition" NOT NULL DEFAULT 'DRAFT',
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "terminal_by_id" TEXT,
  "terminal_at" TIMESTAMP(3),
  "terminal_reason" TEXT,
  CONSTRAINT "final_quality_batch_quantity_positive" CHECK ("physical_quantity" > 0),
  CONSTRAINT "final_quality_batch_number_positive" CHECK ("batch_number" > 0),
  CONSTRAINT "final_quality_batch_terminal_consistent" CHECK (
    ("disposition" IN ('DRAFT', 'AWAITING_REINSPECTION') AND "terminal_by_id" IS NULL AND "terminal_at" IS NULL) OR
    ("disposition" IN ('RELEASED', 'PERMANENTLY_REJECTED', 'CANCELLED') AND "terminal_by_id" IS NOT NULL AND "terminal_at" IS NOT NULL)
  ),
  CONSTRAINT "final_quality_batches_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "final_quality_batches_process_flow_activity_id_fkey" FOREIGN KEY ("process_flow_activity_id") REFERENCES "process_flow_version_stages"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "final_quality_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "final_quality_batches_terminal_by_id_fkey" FOREIGN KEY ("terminal_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "final_quality_batch_number_key" ON "final_quality_batches"("job_order_id", "process_flow_activity_id", "batch_number");
CREATE INDEX "final_quality_batch_state_idx" ON "final_quality_batches"("job_order_id", "process_flow_activity_id", "disposition");

CREATE TABLE "final_quality_batch_allocations" (
  "id" TEXT PRIMARY KEY,
  "final_quality_batch_id" TEXT NOT NULL,
  "job_order_line_size_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "final_quality_batch_allocation_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "final_quality_batch_allocations_batch_id_fkey" FOREIGN KEY ("final_quality_batch_id") REFERENCES "final_quality_batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "final_quality_batch_allocations_size_id_fkey" FOREIGN KEY ("job_order_line_size_id") REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "final_quality_batch_allocation_size_key" ON "final_quality_batch_allocations"("final_quality_batch_id", "job_order_line_size_id");
CREATE INDEX "final_quality_batch_allocation_size_idx" ON "final_quality_batch_allocations"("job_order_line_size_id");

ALTER TABLE "quality_activity_executions" ADD COLUMN "final_quality_batch_id" TEXT;
ALTER TABLE "quality_activity_executions"
  ADD CONSTRAINT "quality_activity_executions_final_quality_batch_id_fkey"
  FOREIGN KEY ("final_quality_batch_id") REFERENCES "final_quality_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "quality_execution_final_batch_attempt_idx" ON "quality_activity_executions"("final_quality_batch_id", "attempt_number");

CREATE TABLE "qa_releases" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL,
  "source_quality_execution_id" TEXT NOT NULL,
  "final_quality_batch_id" TEXT NOT NULL,
  "released_by_id" TEXT NOT NULL,
  "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qa_releases_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "qa_releases_source_execution_id_fkey" FOREIGN KEY ("source_quality_execution_id") REFERENCES "quality_activity_executions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "qa_releases_final_quality_batch_id_fkey" FOREIGN KEY ("final_quality_batch_id") REFERENCES "final_quality_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "qa_releases_released_by_id_fkey" FOREIGN KEY ("released_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "qa_release_source_execution_key" ON "qa_releases"("source_quality_execution_id");
CREATE UNIQUE INDEX "qa_release_final_batch_key" ON "qa_releases"("final_quality_batch_id");
CREATE INDEX "qa_release_job_order_idx" ON "qa_releases"("job_order_id", "released_at");

CREATE TABLE "qa_release_lines" (
  "id" TEXT PRIMARY KEY,
  "qa_release_id" TEXT NOT NULL,
  "job_order_line_size_id" TEXT NOT NULL,
  "purchase_order_line_size_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "qa_release_line_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "qa_release_lines_release_id_fkey" FOREIGN KEY ("qa_release_id") REFERENCES "qa_releases"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "qa_release_lines_job_order_line_size_id_fkey" FOREIGN KEY ("job_order_line_size_id") REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "qa_release_lines_purchase_order_line_size_id_fkey" FOREIGN KEY ("purchase_order_line_size_id") REFERENCES "distributor_purchase_order_line_sizes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "qa_release_line_size_key" ON "qa_release_lines"("qa_release_id", "job_order_line_size_id");
CREATE INDEX "qa_release_line_po_size_idx" ON "qa_release_lines"("purchase_order_line_size_id");

CREATE OR REPLACE FUNCTION validate_final_quality_batch_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "job_orders" jo
    JOIN "process_flow_version_stages" q ON q."process_flow_version_id" = jo."process_flow_version_id"
    JOIN "quality_form_versions" qfv ON qfv."id" = q."quality_form_version_id"
    WHERE jo."id" = NEW."job_order_id"
      AND q."id" = NEW."process_flow_activity_id"
      AND q."status" = 'ACTIVE'
      AND q."activity_type" = 'QUALITY'
      AND q."quality_execution_mode" = 'IN_PROCESS'
      AND q."execution_multiplicity" = 'BATCHED'
      AND q."coverage_target" = 'PREPARED_QUANTITY'
      AND qfv."activity_type" = 'INSPECTION'
      AND qfv."execution_scope" = 'JOB_ORDER'
  ) THEN
    RAISE EXCEPTION 'Final Quality batch does not match Process-Flow Final authority' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "final_quality_batch_identity_guard"
BEFORE INSERT OR UPDATE OF "job_order_id", "process_flow_activity_id"
ON "final_quality_batches" FOR EACH ROW EXECUTE FUNCTION validate_final_quality_batch_identity();

CREATE OR REPLACE FUNCTION validate_final_quality_batch_allocation() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "final_quality_batches" b
    JOIN "job_order_line_sizes" s ON s."id" = NEW."job_order_line_size_id"
    JOIN "job_order_lines" l ON l."id" = s."job_order_line_id"
    WHERE b."id" = NEW."final_quality_batch_id" AND l."job_order_id" = b."job_order_id"
  ) THEN
    RAISE EXCEPTION 'Final Quality batch allocation must belong to its Job Order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "final_quality_batch_allocation_identity_guard"
BEFORE INSERT OR UPDATE OF "final_quality_batch_id", "job_order_line_size_id"
ON "final_quality_batch_allocations" FOR EACH ROW EXECUTE FUNCTION validate_final_quality_batch_allocation();

CREATE OR REPLACE FUNCTION validate_final_quality_batch_allocation_total() RETURNS trigger AS $$
DECLARE target_batch_id TEXT; expected INTEGER; allocated INTEGER;
BEGIN
  target_batch_id := COALESCE(NEW."final_quality_batch_id", OLD."final_quality_batch_id");
  SELECT "physical_quantity" INTO expected FROM "final_quality_batches" WHERE "id" = target_batch_id;
  IF expected IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM("quantity"), 0) INTO allocated FROM "final_quality_batch_allocations" WHERE "final_quality_batch_id" = target_batch_id;
  IF allocated <> expected THEN
    RAISE EXCEPTION 'Final Quality batch allocation total must equal physical quantity' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "final_quality_batch_allocation_total_guard"
AFTER INSERT OR UPDATE OR DELETE ON "final_quality_batch_allocations"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_final_quality_batch_allocation_total();

CREATE OR REPLACE FUNCTION prevent_final_quality_batch_allocation_mutation() RETURNS trigger AS $$
DECLARE target_batch_id TEXT;
BEGIN
  target_batch_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."final_quality_batch_id" ELSE NEW."final_quality_batch_id" END;
  IF EXISTS (SELECT 1 FROM "quality_activity_executions" WHERE "final_quality_batch_id" = target_batch_id) THEN
    RAISE EXCEPTION 'Final Quality batch allocation is immutable after inspection begins' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "final_quality_batch_allocation_immutable_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "final_quality_batch_allocations"
FOR EACH ROW EXECUTE FUNCTION prevent_final_quality_batch_allocation_mutation();

CREATE OR REPLACE FUNCTION prevent_final_quality_batch_physical_mutation() RETURNS trigger AS $$
DECLARE allocated INTEGER;
BEGIN
  IF NEW."physical_quantity" IS DISTINCT FROM OLD."physical_quantity" THEN
    SELECT COALESCE(SUM("quantity"), 0) INTO allocated
    FROM "final_quality_batch_allocations" WHERE "final_quality_batch_id" = OLD."id";
    IF allocated <> NEW."physical_quantity" THEN
      RAISE EXCEPTION 'Final Quality batch physical quantity must equal its allocation total' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "quality_activity_executions" WHERE "final_quality_batch_id" = OLD."id") THEN
    RAISE EXCEPTION 'Final Quality batch physical identity is immutable after inspection begins' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "final_quality_batch_physical_immutable_guard"
BEFORE UPDATE OF "job_order_id", "process_flow_activity_id", "batch_number", "physical_quantity"
ON "final_quality_batches" FOR EACH ROW EXECUTE FUNCTION prevent_final_quality_batch_physical_mutation();

CREATE OR REPLACE FUNCTION validate_final_quality_batch_physical_total() RETURNS trigger AS $$
DECLARE allocated INTEGER;
BEGIN
  SELECT COALESCE(SUM("quantity"), 0) INTO allocated
  FROM "final_quality_batch_allocations" WHERE "final_quality_batch_id" = NEW."id";
  IF allocated <> NEW."physical_quantity" THEN
    RAISE EXCEPTION 'Final Quality batch physical quantity must equal its allocation total' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "final_quality_batch_physical_total_guard"
AFTER UPDATE OF "physical_quantity" ON "final_quality_batches"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_final_quality_batch_physical_total();

CREATE OR REPLACE FUNCTION validate_quality_execution_final_batch() RETURNS trigger AS $$
BEGIN
  IF NEW."final_quality_batch_id" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "final_quality_batches" b
    WHERE b."id" = NEW."final_quality_batch_id"
      AND b."job_order_id" = NEW."job_order_id"
      AND b."process_flow_activity_id" = NEW."process_flow_activity_id"
      AND b."batch_number" = NEW."batch_number"
      AND b."physical_quantity" = NEW."inspected_quantity"
  ) THEN
    RAISE EXCEPTION 'Quality execution does not match its physical Final batch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "quality_execution_final_batch_guard"
BEFORE INSERT OR UPDATE OF "final_quality_batch_id", "job_order_id", "process_flow_activity_id", "batch_number", "inspected_quantity"
ON "quality_activity_executions" FOR EACH ROW EXECUTE FUNCTION validate_quality_execution_final_batch();

CREATE OR REPLACE FUNCTION validate_qa_release_line_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "qa_releases" r
    JOIN "job_order_line_sizes" s ON s."id" = NEW."job_order_line_size_id"
    JOIN "job_order_lines" l ON l."id" = s."job_order_line_id"
    WHERE r."id" = NEW."qa_release_id"
      AND l."job_order_id" = r."job_order_id"
      AND s."purchase_order_line_size_id" = NEW."purchase_order_line_size_id"
  ) THEN
    RAISE EXCEPTION 'QA release line does not match its Job Order size' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "qa_release_line_identity_guard"
BEFORE INSERT OR UPDATE OF "qa_release_id", "job_order_line_size_id", "purchase_order_line_size_id"
ON "qa_release_lines" FOR EACH ROW EXECUTE FUNCTION validate_qa_release_line_identity();

CREATE OR REPLACE FUNCTION validate_process_final_release() RETURNS trigger AS $$
DECLARE release_id TEXT; release_batch_id TEXT; release_quantity INTEGER; allocation_quantity INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'qa_releases' THEN
    release_id := COALESCE(NEW."id", OLD."id");
  ELSE
    release_id := COALESCE(NEW."qa_release_id", OLD."qa_release_id");
  END IF;
  SELECT "final_quality_batch_id" INTO release_batch_id
  FROM "qa_releases" WHERE "id" = release_id;
  IF release_batch_id IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "qa_releases" r
    JOIN "quality_activity_executions" e ON e."id" = r."source_quality_execution_id"
    JOIN "final_quality_batches" b ON b."id" = r."final_quality_batch_id"
    WHERE r."id" = release_id
      AND e."final_quality_batch_id" = b."id"
      AND e."job_order_id" = r."job_order_id"
      AND e."status" = 'FINALIZED'
      AND e."outcome" = 'PASS'
      AND b."disposition" = 'RELEASED'
  ) THEN
    RAISE EXCEPTION 'Process-Flow Final release requires a finalized PASS and released physical batch' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(SUM("quantity"), 0) INTO release_quantity FROM "qa_release_lines" WHERE "qa_release_id" = release_id;
  SELECT COALESCE(SUM("quantity"), 0) INTO allocation_quantity FROM "final_quality_batch_allocations" WHERE "final_quality_batch_id" = release_batch_id;
  IF release_quantity <> allocation_quantity THEN
    RAISE EXCEPTION 'Process-Flow Final release lines must equal the physical batch allocation' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "qa_release_process_final_guard"
AFTER INSERT OR UPDATE ON "qa_releases"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_process_final_release();
CREATE CONSTRAINT TRIGGER "qa_release_line_process_final_guard"
AFTER INSERT OR UPDATE OR DELETE ON "qa_release_lines"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_process_final_release();

CREATE OR REPLACE FUNCTION validate_released_final_batch() RETURNS trigger AS $$
BEGIN
  IF NEW."disposition" = 'RELEASED' AND NOT EXISTS (
    SELECT 1 FROM "qa_releases" r
    WHERE r."final_quality_batch_id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Released physical Final batch requires a QA release' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "final_quality_batch_release_guard"
AFTER INSERT OR UPDATE OF "disposition" ON "final_quality_batches"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_released_final_batch();

CREATE OR REPLACE FUNCTION prevent_qa_release_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'QA release ledger is append-only' USING ERRCODE = '23514';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "qa_release_immutable_guard"
BEFORE UPDATE OR DELETE ON "qa_releases" FOR EACH ROW EXECUTE FUNCTION prevent_qa_release_mutation();
CREATE TRIGGER "qa_release_line_immutable_guard"
BEFORE UPDATE OR DELETE ON "qa_release_lines" FOR EACH ROW EXECUTE FUNCTION prevent_qa_release_mutation();
