-- ERVE-015 (pre-production): discard incompatible QA transaction history.
-- The former form was session-wide, so neither its checklist nor its lifecycle
-- can be converted truthfully into independent size forms.

-- Detach every trigger before removing its table and remove functions whose
-- bodies hard-code the obsolete qa_inspection_lines relation.
DROP TRIGGER IF EXISTS "qa_first_pass_capacity" ON "qa_inspection_lines";
DROP TRIGGER IF EXISTS "qa_reinspection_capacity" ON "qa_inspection_lines";
DROP TRIGGER IF EXISTS "qa_inspection_line_job_order_match" ON "qa_inspection_lines";
DROP FUNCTION IF EXISTS enforce_qa_first_pass_capacity();
DROP FUNCTION IF EXISTS enforce_qa_reinspection_capacity();
DROP FUNCTION IF EXISTS enforce_qa_inspection_line_job_order_match();

-- Reset only QA transactional records. Job orders, PO/master data and files
-- outside QA evidence remain untouched.
DELETE FROM "qa_evidence";
DROP TABLE IF EXISTS "qa_evidence";
DROP TABLE IF EXISTS "qa_rework_tasks" CASCADE;
DROP TABLE IF EXISTS "qa_inspection_checklist_items";
DROP TABLE IF EXISTS "qa_inspection_lines";
DROP TABLE IF EXISTS "qa_inspection_sessions";

CREATE TABLE "qa_inspection_sessions" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL REFERENCES "job_orders"("id") ON DELETE CASCADE,
  "inspector_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "cycle_number" INTEGER NOT NULL CHECK ("cycle_number" > 0),
  "status" "QaInspectionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "finalized_at" TIMESTAMP(3),
  "reopened_at" TIMESTAMP(3),
  "reopened_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reopen_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "qa_inspection_sessions_job_order_id_status_idx" ON "qa_inspection_sessions"("job_order_id", "status");
CREATE INDEX "qa_inspection_sessions_inspector_id_idx" ON "qa_inspection_sessions"("inspector_id");

CREATE TABLE "qa_size_inspection_forms" (
  "id" TEXT PRIMARY KEY,
  "inspection_session_id" TEXT NOT NULL REFERENCES "qa_inspection_sessions"("id") ON DELETE CASCADE,
  "job_order_line_size_id" TEXT NOT NULL REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT,
  "source_rework_task_id" TEXT,
  "sample_quantity" INTEGER CHECK ("sample_quantity" IS NULL OR "sample_quantity" >= 0),
  "inspection_remarks" TEXT,
  "status" "QaInspectionStatus" NOT NULL DEFAULT 'DRAFT',
  "finalized_at" TIMESTAMP(3),
  "reopened_at" TIMESTAMP(3),
  "reopened_by_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reopen_reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "inspected_quantity" INTEGER NOT NULL,
  "accepted_quantity" INTEGER NOT NULL,
  "rework_quantity" INTEGER NOT NULL,
  "permanently_rejected_quantity" INTEGER NOT NULL,
  "defect_category" "QaDefectCategory",
  "other_defect_details" TEXT,
  "defect_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "qa_size_inspection_forms_nonnegative" CHECK (
    "inspected_quantity" >= 0 AND "accepted_quantity" >= 0 AND "rework_quantity" >= 0 AND "permanently_rejected_quantity" >= 0
  ),
  CONSTRAINT "qa_size_inspection_forms_reconcile" CHECK (
    "inspected_quantity" = "accepted_quantity" + "rework_quantity" + "permanently_rejected_quantity"
  ),
  CONSTRAINT "qa_size_inspection_forms_defect_required" CHECK (
    ("rework_quantity" = 0 AND "permanently_rejected_quantity" = 0) OR "defect_category" IS NOT NULL
  ),
  CONSTRAINT "qa_size_inspection_forms_other_defect_details" CHECK (
    ("defect_category" = 'OTHER' AND NULLIF(BTRIM("other_defect_details"), '') IS NOT NULL)
    OR ("defect_category" IS DISTINCT FROM 'OTHER' AND "other_defect_details" IS NULL)
  ),
  UNIQUE ("inspection_session_id", "job_order_line_size_id")
);
CREATE INDEX "qa_size_inspection_forms_job_order_line_size_id_idx" ON "qa_size_inspection_forms"("job_order_line_size_id");
CREATE INDEX "qa_size_inspection_forms_source_rework_task_id_idx" ON "qa_size_inspection_forms"("source_rework_task_id");
CREATE INDEX "qa_size_inspection_forms_inspection_session_id_status_idx" ON "qa_size_inspection_forms"("inspection_session_id", "status");

CREATE TABLE "qa_size_inspection_checklist_items" (
  "id" TEXT PRIMARY KEY,
  "inspection_form_id" TEXT NOT NULL REFERENCES "qa_size_inspection_forms"("id") ON DELETE CASCADE,
  "item_code" TEXT NOT NULL,
  "status" "QaChecklistStatus",
  "remarks" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("inspection_form_id", "item_code")
);
CREATE INDEX "qa_size_inspection_checklist_items_inspection_form_id_idx" ON "qa_size_inspection_checklist_items"("inspection_form_id");

CREATE TABLE "qa_rework_tasks" (
  "id" TEXT PRIMARY KEY,
  "job_order_id" TEXT NOT NULL REFERENCES "job_orders"("id") ON DELETE CASCADE,
  "job_order_line_size_id" TEXT NOT NULL REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT,
  "source_line_id" TEXT NOT NULL UNIQUE REFERENCES "qa_size_inspection_forms"("id") ON DELETE RESTRICT,
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
  CHECK ("attempt_number" > 0 AND "assigned_quantity" > 0 AND "version" > 0),
  UNIQUE ("job_order_line_size_id", "attempt_number")
);
ALTER TABLE "qa_size_inspection_forms" ADD CONSTRAINT "qa_size_inspection_forms_source_rework_task_id_fkey"
  FOREIGN KEY ("source_rework_task_id") REFERENCES "qa_rework_tasks"("id") ON DELETE RESTRICT;
CREATE INDEX "qa_rework_tasks_job_order_id_status_idx" ON "qa_rework_tasks"("job_order_id", "status");

CREATE TABLE "qa_evidence" (
  "id" TEXT PRIMARY KEY,
  "inspection_session_id" TEXT NOT NULL REFERENCES "qa_inspection_sessions"("id") ON DELETE CASCADE,
  "inspection_line_id" TEXT REFERENCES "qa_size_inspection_forms"("id") ON DELETE CASCADE,
  "file_id" TEXT NOT NULL REFERENCES "files"("id") ON DELETE RESTRICT,
  "checksum_sha256" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("inspection_session_id", "checksum_sha256")
);
CREATE INDEX "qa_evidence_inspection_line_id_idx" ON "qa_evidence"("inspection_line_id");
CREATE INDEX "qa_evidence_file_id_idx" ON "qa_evidence"("file_id");

CREATE OR REPLACE FUNCTION enforce_qa_form_job_order_match() RETURNS trigger AS $$
DECLARE session_job_order_id TEXT; size_job_order_id TEXT;
BEGIN
  SELECT "job_order_id" INTO session_job_order_id FROM "qa_inspection_sessions" WHERE "id" = NEW."inspection_session_id";
  SELECT jol."job_order_id" INTO size_job_order_id FROM "job_order_line_sizes" jols JOIN "job_order_lines" jol ON jol."id" = jols."job_order_line_id" WHERE jols."id" = NEW."job_order_line_size_id";
  IF session_job_order_id IS NULL OR size_job_order_id IS NULL OR session_job_order_id <> size_job_order_id THEN
    RAISE EXCEPTION 'QA inspection size allocation must belong to its inspection job order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "qa_size_inspection_form_job_order_match" AFTER INSERT OR UPDATE OF "inspection_session_id", "job_order_line_size_id"
  ON "qa_size_inspection_forms" FOR EACH ROW EXECUTE FUNCTION enforce_qa_form_job_order_match();

CREATE OR REPLACE FUNCTION enforce_qa_first_pass_capacity() RETURNS trigger AS $$
DECLARE prepared INTEGER; consumed INTEGER;
BEGIN
  IF NEW."source_rework_task_id" IS NOT NULL THEN RETURN NEW; END IF;
  SELECT "prepared_quantity" INTO prepared FROM "job_order_line_sizes" WHERE "id" = NEW."job_order_line_size_id" FOR UPDATE;
  SELECT COALESCE(SUM(f."inspected_quantity"), 0) INTO consumed FROM "qa_size_inspection_forms" f JOIN "qa_inspection_sessions" s ON s."id" = f."inspection_session_id"
  WHERE f."job_order_line_size_id" = NEW."job_order_line_size_id" AND f."source_rework_task_id" IS NULL
    AND s."status" IN ('DRAFT', 'FINALIZED') AND f."id" <> NEW."id";
  IF consumed + NEW."inspected_quantity" > prepared THEN RAISE EXCEPTION 'QA prepared quantity over-consumed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "qa_first_pass_capacity" BEFORE INSERT OR UPDATE ON "qa_size_inspection_forms" FOR EACH ROW EXECUTE FUNCTION enforce_qa_first_pass_capacity();

CREATE OR REPLACE FUNCTION enforce_qa_reinspection_capacity() RETURNS trigger AS $$
DECLARE assigned INTEGER; consumed INTEGER;
BEGIN
  IF NEW."source_rework_task_id" IS NULL THEN RETURN NEW; END IF;
  SELECT "assigned_quantity" INTO assigned FROM "qa_rework_tasks" WHERE "id" = NEW."source_rework_task_id" FOR UPDATE;
  SELECT COALESCE(SUM("inspected_quantity"), 0) INTO consumed FROM "qa_size_inspection_forms" WHERE "source_rework_task_id" = NEW."source_rework_task_id" AND "id" <> NEW."id";
  IF consumed + NEW."inspected_quantity" > assigned THEN RAISE EXCEPTION 'QA rework quantity over-consumed' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "qa_reinspection_capacity" BEFORE INSERT OR UPDATE ON "qa_size_inspection_forms" FOR EACH ROW EXECUTE FUNCTION enforce_qa_reinspection_capacity();
