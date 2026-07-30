ALTER TYPE "JobOrderStatus" ADD VALUE IF NOT EXISTS 'REWORK_REQUIRED';
ALTER TYPE "JobOrderStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_REINSPECTION';
ALTER TYPE "JobOrderStatus" ADD VALUE IF NOT EXISTS 'QA_APPROVED';

CREATE TYPE "QaInspectionStatus" AS ENUM ('DRAFT', 'FINALIZED', 'REOPENED', 'VOIDED');
CREATE TYPE "QaDefectCategory" AS ENUM ('STITCHING', 'FABRIC', 'PRINT_EMBROIDERY', 'MEASUREMENT', 'FINISHING', 'PACKAGING', 'OTHER');
CREATE TYPE "QaReworkStatus" AS ENUM ('PENDING_ACKNOWLEDGEMENT', 'ACKNOWLEDGED', 'READY_FOR_REINSPECTION', 'CLOSED');

CREATE TABLE "qa_inspection_sessions" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL REFERENCES "job_orders"("id") ON DELETE CASCADE,
  "inspector_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "cycle_number" INTEGER NOT NULL,
  "status" "QaInspectionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "finalized_at" TIMESTAMP(3),
  "reopened_at" TIMESTAMP(3),
  "reopened_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reopen_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qa_inspection_sessions_cycle_positive" CHECK ("cycle_number" > 0),
  CONSTRAINT "qa_inspection_sessions_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "qa_inspection_sessions_job_order_id_status_idx" ON "qa_inspection_sessions"("job_order_id", "status");
CREATE INDEX "qa_inspection_sessions_inspector_id_idx" ON "qa_inspection_sessions"("inspector_id");

CREATE TABLE "qa_inspection_lines" (
  "id" TEXT PRIMARY KEY,
  "inspection_session_id" TEXT NOT NULL REFERENCES "qa_inspection_sessions"("id") ON DELETE CASCADE,
  "job_order_line_size_id" TEXT NOT NULL REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT,
  "source_rework_task_id" TEXT,
  "inspected_quantity" INTEGER NOT NULL,
  "accepted_quantity" INTEGER NOT NULL,
  "rework_quantity" INTEGER NOT NULL,
  "permanently_rejected_quantity" INTEGER NOT NULL,
  "defect_category" "QaDefectCategory",
  "defect_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qa_inspection_lines_nonnegative" CHECK (
    "inspected_quantity" >= 0 AND "accepted_quantity" >= 0 AND
    "rework_quantity" >= 0 AND "permanently_rejected_quantity" >= 0
  ),
  CONSTRAINT "qa_inspection_lines_reconcile" CHECK (
    "inspected_quantity" = "accepted_quantity" + "rework_quantity" + "permanently_rejected_quantity"
  ),
  CONSTRAINT "qa_inspection_lines_defect_required" CHECK (
    ("rework_quantity" = 0 AND "permanently_rejected_quantity" = 0) OR "defect_category" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "qa_inspection_lines_session_size_source_key" ON "qa_inspection_lines"("inspection_session_id", "job_order_line_size_id", COALESCE("source_rework_task_id", ''));
CREATE INDEX "qa_inspection_lines_job_order_line_size_id_idx" ON "qa_inspection_lines"("job_order_line_size_id");
CREATE INDEX "qa_inspection_lines_source_rework_task_id_idx" ON "qa_inspection_lines"("source_rework_task_id");

CREATE TABLE "qa_rework_tasks" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL REFERENCES "job_orders"("id") ON DELETE CASCADE,
  "job_order_line_size_id" TEXT NOT NULL REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT,
  "source_line_id" TEXT NOT NULL UNIQUE REFERENCES "qa_inspection_lines"("id") ON DELETE RESTRICT,
  "attempt_number" INTEGER NOT NULL,
  "assigned_quantity" INTEGER NOT NULL,
  "status" "QaReworkStatus" NOT NULL DEFAULT 'PENDING_ACKNOWLEDGEMENT',
  "acknowledged_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "acknowledged_at" TIMESTAMP(3),
  "ready_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "ready_at" TIMESTAMP(3),
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qa_rework_tasks_quantities_positive" CHECK ("attempt_number" > 0 AND "assigned_quantity" > 0 AND "version" > 0),
  UNIQUE ("job_order_line_size_id", "attempt_number")
);
CREATE INDEX "qa_rework_tasks_job_order_id_status_idx" ON "qa_rework_tasks"("job_order_id", "status");
ALTER TABLE "qa_inspection_lines" ADD CONSTRAINT "qa_inspection_lines_source_rework_task_id_fkey" FOREIGN KEY ("source_rework_task_id") REFERENCES "qa_rework_tasks"("id") ON DELETE RESTRICT;

CREATE TABLE "qa_evidence" (
  "id" TEXT PRIMARY KEY,
  "inspection_session_id" TEXT NOT NULL REFERENCES "qa_inspection_sessions"("id") ON DELETE CASCADE,
  "inspection_line_id" TEXT REFERENCES "qa_inspection_lines"("id") ON DELETE CASCADE,
  "file_id" TEXT NOT NULL REFERENCES "files"("id") ON DELETE RESTRICT,
  "checksum_sha256" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("inspection_session_id", "checksum_sha256")
);
CREATE INDEX "qa_evidence_inspection_line_id_idx" ON "qa_evidence"("inspection_line_id");
CREATE INDEX "qa_evidence_file_id_idx" ON "qa_evidence"("file_id");

-- PostgreSQL constraint triggers protect aggregate quantities even from
-- non-API writers. API advisory locks provide an earlier stable conflict.
CREATE OR REPLACE FUNCTION enforce_qa_first_pass_capacity() RETURNS trigger AS $$
DECLARE prepared INTEGER; consumed INTEGER;
BEGIN
  IF NEW."source_rework_task_id" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT "prepared_quantity" INTO prepared FROM "job_order_line_sizes" WHERE "id" = NEW."job_order_line_size_id" FOR UPDATE;
  SELECT COALESCE(SUM(l."inspected_quantity"), 0) INTO consumed
    FROM "qa_inspection_lines" l JOIN "qa_inspection_sessions" s ON s."id" = l."inspection_session_id"
    WHERE l."job_order_line_size_id" = NEW."job_order_line_size_id"
      AND l."source_rework_task_id" IS NULL AND s."status" IN ('DRAFT', 'FINALIZED')
      AND l."id" <> NEW."id";
  IF consumed + NEW."inspected_quantity" > prepared THEN RAISE EXCEPTION 'QA prepared quantity over-consumed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "qa_first_pass_capacity" BEFORE INSERT OR UPDATE ON "qa_inspection_lines" FOR EACH ROW EXECUTE FUNCTION enforce_qa_first_pass_capacity();

CREATE OR REPLACE FUNCTION enforce_qa_reinspection_capacity() RETURNS trigger AS $$
DECLARE assigned INTEGER; consumed INTEGER;
BEGIN
  IF NEW."source_rework_task_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "assigned_quantity" INTO assigned FROM "qa_rework_tasks" WHERE "id" = NEW."source_rework_task_id" FOR UPDATE;
  SELECT COALESCE(SUM("inspected_quantity"), 0) INTO consumed FROM "qa_inspection_lines"
    WHERE "source_rework_task_id" = NEW."source_rework_task_id" AND "id" <> NEW."id";
  IF consumed + NEW."inspected_quantity" > assigned THEN RAISE EXCEPTION 'QA rework quantity over-consumed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "qa_reinspection_capacity" BEFORE INSERT OR UPDATE ON "qa_inspection_lines" FOR EACH ROW EXECUTE FUNCTION enforce_qa_reinspection_capacity();

