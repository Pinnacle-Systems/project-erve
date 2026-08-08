CREATE TYPE "QaChecklistStatus" AS ENUM ('YES', 'NO', 'AVAILABLE');

ALTER TABLE "qa_inspection_sessions"
  ADD COLUMN "sample_quantity" INTEGER,
  ADD CONSTRAINT "qa_inspection_sessions_sample_quantity_nonnegative"
    CHECK ("sample_quantity" IS NULL OR "sample_quantity" >= 0);

CREATE TABLE "qa_inspection_checklist_items" (
  "id" TEXT PRIMARY KEY,
  "inspection_session_id" TEXT NOT NULL REFERENCES "qa_inspection_sessions"("id") ON DELETE CASCADE,
  "item_code" TEXT NOT NULL,
  "status" "QaChecklistStatus",
  "remarks" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("inspection_session_id", "item_code")
);
CREATE INDEX "qa_inspection_checklist_items_inspection_session_id_idx"
  ON "qa_inspection_checklist_items"("inspection_session_id");

-- A line has two parents. This deferred constraint trigger makes the shared
-- Job Order identity enforceable in PostgreSQL, so a valid size allocation
-- from another Job Order cannot be persisted against an inspection session.
CREATE OR REPLACE FUNCTION enforce_qa_inspection_line_job_order_match() RETURNS trigger AS $$
DECLARE session_job_order_id TEXT; size_job_order_id TEXT;
BEGIN
  SELECT "job_order_id" INTO session_job_order_id
    FROM "qa_inspection_sessions" WHERE "id" = NEW."inspection_session_id";
  SELECT jol."job_order_id" INTO size_job_order_id
    FROM "job_order_line_sizes" jols JOIN "job_order_lines" jol ON jol."id" = jols."job_order_line_id"
    WHERE jols."id" = NEW."job_order_line_size_id";
  IF session_job_order_id IS NULL OR size_job_order_id IS NULL OR session_job_order_id <> size_job_order_id THEN
    RAISE EXCEPTION 'QA inspection size allocation must belong to its inspection job order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "qa_inspection_line_job_order_match"
  AFTER INSERT OR UPDATE OF "inspection_session_id", "job_order_line_size_id" ON "qa_inspection_lines"
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
  EXECUTE FUNCTION enforce_qa_inspection_line_job_order_match();
