CREATE TYPE "QualityActivityExecutionStatus" AS ENUM ('DRAFT', 'FINALIZED');
CREATE TYPE "QualityInspectionOutcome" AS ENUM ('PASS', 'FAIL');
CREATE TYPE "QualityDefectSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR');

CREATE TABLE "quality_activity_executions" (
  "id" TEXT PRIMARY KEY, "job_order_id" TEXT NOT NULL,
  "process_flow_activity_id" TEXT NOT NULL, "quality_form_version_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL DEFAULT 1,
  "batch_number" INTEGER NOT NULL DEFAULT 1,
  "inspected_quantity" INTEGER,
  "sample_job_order_line_size_id" TEXT,
  "sample_quantity" INTEGER,
  "status" "QualityActivityExecutionStatus" NOT NULL DEFAULT 'DRAFT',
  "started_by_id" TEXT NOT NULL, "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalized_by_id" TEXT, "finalized_at" TIMESTAMP(3),
  "outcome_component_id" TEXT, "outcome" "QualityInspectionOutcome", "outcome_remarks" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_execution_attempt_positive" CHECK ("attempt_number" > 0),
  CONSTRAINT "quality_execution_batch_positive" CHECK ("batch_number" > 0),
  CONSTRAINT "quality_execution_inspected_positive" CHECK ("inspected_quantity" IS NULL OR "inspected_quantity" > 0),
  CONSTRAINT "quality_execution_sample_context" CHECK (("sample_job_order_line_size_id" IS NULL AND "sample_quantity" IS NULL) OR ("sample_job_order_line_size_id" IS NOT NULL AND "sample_quantity" > 0)),
  CONSTRAINT "quality_execution_finalize_consistent" CHECK (
    ("status" = 'DRAFT' AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL) OR
    ("status" = 'FINALIZED' AND "finalized_at" IS NOT NULL AND "finalized_by_id" IS NOT NULL)
  ),
  CONSTRAINT "quality_activity_executions_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE,
  CONSTRAINT "quality_activity_executions_process_flow_activity_id_fkey" FOREIGN KEY ("process_flow_activity_id") REFERENCES "process_flow_version_stages"("id") ON DELETE RESTRICT,
  CONSTRAINT "quality_activity_executions_quality_form_version_id_fkey" FOREIGN KEY ("quality_form_version_id") REFERENCES "quality_form_versions"("id") ON DELETE RESTRICT,
  CONSTRAINT "quality_activity_executions_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "quality_activity_executions_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "quality_activity_executions_sample_size_id_fkey" FOREIGN KEY ("sample_job_order_line_size_id") REFERENCES "job_order_line_sizes"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "quality_execution_attempt_batch_key" ON "quality_activity_executions"("job_order_id", "process_flow_activity_id", "attempt_number", "batch_number");
CREATE INDEX "quality_execution_form_idx" ON "quality_activity_executions"("quality_form_version_id");

CREATE FUNCTION validate_quality_execution_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "job_orders" jo JOIN "process_flow_version_stages" a
      ON a."process_flow_version_id" = jo."process_flow_version_id"
    WHERE jo.id = NEW."job_order_id" AND a.id = NEW."process_flow_activity_id"
      AND a."activity_type" = 'QUALITY' AND a."quality_form_version_id" = NEW."quality_form_version_id"
  ) THEN RAISE EXCEPTION 'quality execution identity does not match job order activity/form version'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "quality_execution_identity_guard" BEFORE INSERT OR UPDATE OF "job_order_id", "process_flow_activity_id", "quality_form_version_id"
ON "quality_activity_executions" FOR EACH ROW EXECUTE FUNCTION validate_quality_execution_identity();

CREATE TABLE "quality_checklist_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "item_key" TEXT NOT NULL, "response" TEXT NOT NULL, "remarks" TEXT);
CREATE UNIQUE INDEX "quality_checklist_response_key" ON "quality_checklist_responses"("execution_id", "component_id", "item_key");
CREATE TABLE "quality_aql_results" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "severity" "QualityDefectSeverity" NOT NULL, "max_allowed" INTEGER, "found" INTEGER, "result" "QualityInspectionOutcome", CHECK ("max_allowed" IS NULL OR "max_allowed" >= 0), CHECK ("found" IS NULL OR "found" >= 0));
CREATE UNIQUE INDEX "quality_aql_result_key" ON "quality_aql_results"("execution_id", "component_id", "severity");
CREATE TABLE "quality_defects" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "description" TEXT NOT NULL, "severity" "QualityDefectSeverity" NOT NULL, "quantity" INTEGER, CHECK ("quantity" IS NULL OR "quantity" >= 0));
CREATE INDEX "quality_defect_reporting_idx" ON "quality_defects"("execution_id", "component_id", "severity");
CREATE TABLE "quality_corrective_actions" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "values" JSONB NOT NULL);
CREATE INDEX "quality_corrective_action_idx" ON "quality_corrective_actions"("execution_id", "component_id");
CREATE TABLE "quality_test_results" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "test_key" TEXT NOT NULL, "response" TEXT NOT NULL, "remarks" TEXT);
CREATE UNIQUE INDEX "quality_test_result_key" ON "quality_test_results"("execution_id", "component_id", "test_key");
CREATE TABLE "quality_quantity_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "field_key" TEXT NOT NULL, "value" DECIMAL(14,3) NOT NULL);
CREATE UNIQUE INDEX "quality_quantity_response_key" ON "quality_quantity_responses"("execution_id", "component_id", "field_key");
CREATE TABLE "quality_comment_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "value" TEXT NOT NULL);
CREATE UNIQUE INDEX "quality_comment_response_key" ON "quality_comment_responses"("execution_id", "component_id");
CREATE TABLE "quality_signoffs" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "role_key" TEXT NOT NULL, "signatory_name" TEXT NOT NULL, "recorded_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "quality_signoff_key" ON "quality_signoffs"("execution_id", "component_id", "role_key");
CREATE TABLE "quality_attachments" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "requirement_key" TEXT NOT NULL, "file_id" TEXT NOT NULL REFERENCES "files"("id") ON DELETE RESTRICT, "checksum_sha256" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "quality_attachment_scope_checksum_key" ON "quality_attachments"("execution_id", "component_id", "requirement_key", "checksum_sha256");
CREATE INDEX "quality_attachment_file_idx" ON "quality_attachments"("file_id");

CREATE TABLE "quality_field_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "field_key" TEXT NOT NULL, "value" TEXT NOT NULL);
CREATE UNIQUE INDEX "quality_field_response_key" ON "quality_field_responses"("execution_id", "component_id", "field_key");
CREATE TABLE "quality_attendee_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "role_key" TEXT NOT NULL, "attendee_name" TEXT NOT NULL);
CREATE UNIQUE INDEX "quality_attendee_response_key" ON "quality_attendee_responses"("execution_id", "component_id", "role_key", "attendee_name");
CREATE TABLE "quality_action_responses" ("id" TEXT PRIMARY KEY, "execution_id" TEXT NOT NULL REFERENCES "quality_activity_executions"("id") ON DELETE CASCADE, "component_id" TEXT NOT NULL, "row_number" INTEGER NOT NULL, "values" JSONB NOT NULL, CHECK ("row_number" > 0));
CREATE UNIQUE INDEX "quality_action_response_key" ON "quality_action_responses"("execution_id", "component_id", "row_number");

ALTER TABLE "qa_inspection_sessions" ADD COLUMN "quality_activity_execution_id" TEXT;
ALTER TABLE "qa_inspection_sessions" ADD CONSTRAINT "qa_inspection_sessions_quality_execution_fkey" FOREIGN KEY ("quality_activity_execution_id") REFERENCES "quality_activity_executions"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "qa_inspection_sessions_quality_execution_key" ON "qa_inspection_sessions"("quality_activity_execution_id");

CREATE OR REPLACE FUNCTION enforce_qa_first_pass_capacity() RETURNS trigger AS $$
DECLARE prepared INTEGER; consumed INTEGER;
BEGIN
  IF NEW."source_rework_task_id" IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM "qa_inspection_sessions" s WHERE s."id" = NEW."inspection_session_id" AND s."quality_activity_execution_id" IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  SELECT "prepared_quantity" INTO prepared FROM "job_order_line_sizes" WHERE "id" = NEW."job_order_line_size_id" FOR UPDATE;
  SELECT COALESCE(SUM(f."inspected_quantity"), 0) INTO consumed
  FROM "qa_size_inspection_forms" f JOIN "qa_inspection_sessions" s ON s."id" = f."inspection_session_id"
  WHERE f."job_order_line_size_id" = NEW."job_order_line_size_id" AND f."source_rework_task_id" IS NULL
    AND s."quality_activity_execution_id" IS NULL
    AND s."status" IN ('DRAFT', 'FINALIZED') AND f."id" <> NEW."id";
  IF consumed + NEW."inspected_quantity" > prepared THEN
    RAISE EXCEPTION 'QA prepared quantity over-consumed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Existing published INLINE/FINAL v1 definitions predate stable source
-- semantics. Preserve them unchanged for historical Process Flow references,
-- and publish a corrected new version instead of rewriting their JSON.
WITH candidates AS (
  SELECT qfv.*, qf."code",
    'qfv_sem_' || md5(qfv."id" || clock_timestamp()::text) AS "new_id",
    (SELECT COALESCE(MAX(v."version_number"), 0) + 1 FROM "quality_form_versions" v WHERE v."quality_form_id" = qfv."quality_form_id") AS "new_number"
  FROM "quality_form_versions" qfv
  JOIN "quality_forms" qf ON qf."id" = qfv."quality_form_id"
  WHERE qf."code" IN ('INLINE', 'FINAL') AND qfv."status" = 'PUBLISHED'
    AND EXISTS (
      SELECT 1 FROM "quality_form_sections" s JOIN "quality_form_components" c ON c."quality_form_section_id" = s."id"
      WHERE s."quality_form_version_id" = qfv."id"
        AND ((c."type" = 'SYSTEM_CONTEXT' AND (c."config"->'fields'->0->>'sourceKey') IS NULL)
          OR (c."type" = 'PRODUCTION_PROGRESS' AND (c."config"->'metrics'->0->>'sourceActivityCode') IS NULL)
          OR (c."type" = 'QUANTITY_RECONCILIATION' AND EXISTS (SELECT 1 FROM jsonb_array_elements(c."config"->'fields') f WHERE f->>'source' = 'SYSTEM' AND f->>'sourceKey' IS NULL)))
    )
), inserted_versions AS (
  INSERT INTO "quality_form_versions" ("id", "quality_form_id", "version_number", "activity_type", "execution_scope", "status", "published_at", "created_at", "updated_at")
  SELECT "new_id", "quality_form_id", "new_number", "activity_type", "execution_scope", 'PUBLISHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM candidates
  RETURNING "id", "quality_form_id"
), inserted_sections AS (
  INSERT INTO "quality_form_sections" ("id", "quality_form_version_id", "sequence", "title", "description", "created_at", "updated_at")
  SELECT 'qfs_sem_' || md5(c."new_id" || s."sequence"::text), c."new_id", s."sequence", s."title", s."description", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM candidates c JOIN inserted_versions iv ON iv."id" = c."new_id"
  JOIN "quality_form_sections" s ON s."quality_form_version_id" = c."id"
  RETURNING "id", "quality_form_version_id", "sequence"
)
INSERT INTO "quality_form_components" ("id", "quality_form_section_id", "sequence", "type", "title", "description", "config", "created_at", "updated_at")
SELECT 'qfc_sem_' || md5(c."new_id" || s."sequence"::text || component."sequence"::text),
  'qfs_sem_' || md5(c."new_id" || s."sequence"::text), component."sequence", component."type", component."title", component."description",
  CASE
    WHEN component."type" = 'SYSTEM_CONTEXT' THEN jsonb_set(component."config", '{fields}', (
      SELECT jsonb_agg(field || jsonb_build_object('sourceKey', CASE field->>'key'
        WHEN 'supplier' THEN 'SUPPLIER_NAME' WHEN 'style' THEN 'STYLE_NUMBER'
        WHEN 'purchaseOrder' THEN 'PURCHASE_ORDER_NUMBER' WHEN 'customer' THEN 'CUSTOMER_NAME'
        WHEN 'reportDate' THEN 'REPORT_DATE' WHEN 'etd' THEN 'ETD'
        WHEN 'color' THEN 'COLOUR' WHEN 'orderQty' THEN 'ORDER_QUANTITY'
        WHEN 'shipQty' THEN 'SHIP_QUANTITY' WHEN 'merchandiser' THEN 'MERCHANDISER_NAME'
        ELSE 'JOB_ORDER_NUMBER' END) ORDER BY ordinal)
      FROM jsonb_array_elements(component."config"->'fields') WITH ORDINALITY AS x(field, ordinal)))
    WHEN component."type" = 'PRODUCTION_PROGRESS' THEN jsonb_set(component."config", '{metrics}', (
      SELECT jsonb_agg(metric || jsonb_build_object('sourceActivityCode', CASE metric->>'key'
        WHEN 'cutPercentage' THEN 'CUTTING' WHEN 'sewnPercentage' THEN 'SEWING'
        WHEN 'finishPercentage' THEN 'FINISHING' END) ORDER BY ordinal)
      FROM jsonb_array_elements(component."config"->'metrics') WITH ORDINALITY AS x(metric, ordinal)))
    WHEN component."type" = 'QUANTITY_RECONCILIATION' THEN jsonb_set(component."config", '{fields}', (
      SELECT jsonb_agg(CASE WHEN field->>'source' = 'SYSTEM' THEN field || jsonb_build_object('sourceKey', 'ORDER_QUANTITY') ELSE field END ORDER BY ordinal)
      FROM jsonb_array_elements(component."config"->'fields') WITH ORDINALITY AS x(field, ordinal)))
    ELSE component."config" END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM candidates c JOIN inserted_sections new_section ON new_section."quality_form_version_id" = c."new_id"
  JOIN "quality_form_sections" s ON s."quality_form_version_id" = c."id" AND s."sequence" = new_section."sequence"
JOIN "quality_form_components" component ON component."quality_form_section_id" = s."id";

UPDATE "quality_form_versions" old SET "status" = 'RETIRED', "updated_at" = CURRENT_TIMESTAMP
FROM "quality_forms" form
WHERE old."quality_form_id" = form."id" AND form."code" IN ('INLINE', 'FINAL') AND old."status" = 'PUBLISHED'
  AND EXISTS (SELECT 1 FROM "quality_form_versions" newer WHERE newer."quality_form_id" = old."quality_form_id" AND newer."status" = 'PUBLISHED' AND newer."version_number" > old."version_number");

-- Published form definitions are immutable. Create successors only when the
-- confirmed PPM/FINAL semantics are absent from an existing publication.
DO $$
DECLARE
  source_version RECORD;
  new_version_id TEXT;
  new_section_id TEXT;
  source_section RECORD;
  source_component RECORD;
  next_sequence INTEGER;
BEGIN
  FOR source_version IN
    SELECT DISTINCT ON (qf."id") qf."id" AS form_id, qf."code", qfv."id", qfv."version_number",
      qfv."activity_type", qfv."execution_scope"
    FROM "quality_forms" qf JOIN "quality_form_versions" qfv ON qfv."quality_form_id" = qf."id"
    WHERE qf."code" IN ('PPM', 'FINAL') AND qfv."status" = 'PUBLISHED'
      AND ((qf."code" = 'FINAL' AND NOT EXISTS (
        SELECT 1 FROM "quality_form_sections" s JOIN "quality_form_components" c ON c."quality_form_section_id" = s."id"
        WHERE s."quality_form_version_id" = qfv."id" AND c."type" = 'INSPECTION_OUTCOME'))
      OR (qf."code" = 'PPM' AND EXISTS (
        SELECT 1 FROM "quality_form_sections" s JOIN "quality_form_components" c ON c."quality_form_section_id" = s."id",
          jsonb_array_elements(c."config"->'fields') field
        WHERE s."quality_form_version_id" = qfv."id" AND c."type" = 'SYSTEM_CONTEXT'
          AND field->>'sourceKey' IN ('REPORT_DATE','ETD','CUTTING_PLANNING_DATE','SEWING_PLANNING_DATE','MEETING_CONDUCTED_BY'))))
    ORDER BY qf."id", qfv."version_number" DESC
  LOOP
    new_version_id := 'qfv_workflow_' || md5(source_version."id" || clock_timestamp()::text);
    INSERT INTO "quality_form_versions" ("id", "quality_form_id", "version_number", "activity_type", "execution_scope", "status", "published_at", "created_at", "updated_at")
    VALUES (new_version_id, source_version.form_id,
      (SELECT MAX(v."version_number") + 1 FROM "quality_form_versions" v WHERE v."quality_form_id" = source_version.form_id),
      source_version."activity_type", source_version."execution_scope", 'PUBLISHED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    FOR source_section IN SELECT * FROM "quality_form_sections" WHERE "quality_form_version_id" = source_version."id" ORDER BY "sequence"
    LOOP
      new_section_id := 'qfs_workflow_' || md5(new_version_id || source_section."id");
      INSERT INTO "quality_form_sections" ("id", "quality_form_version_id", "sequence", "title", "description", "created_at", "updated_at")
      VALUES (new_section_id, new_version_id, source_section."sequence", source_section."title", source_section."description", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      FOR source_component IN SELECT * FROM "quality_form_components" WHERE "quality_form_section_id" = source_section."id" ORDER BY "sequence"
      LOOP
        INSERT INTO "quality_form_components" ("id", "quality_form_section_id", "sequence", "type", "title", "description", "config", "created_at", "updated_at")
        VALUES ('qfc_workflow_' || md5(new_version_id || source_component."id"), new_section_id, source_component."sequence",
          source_component."type", source_component."title", source_component."description",
          CASE WHEN source_version."code" = 'PPM' AND source_component."type" = 'SYSTEM_CONTEXT'
            THEN jsonb_set(source_component."config", '{fields}',
              (SELECT COALESCE(jsonb_agg(field ORDER BY ordinal), '[]'::jsonb)
               FROM jsonb_array_elements(source_component."config"->'fields') WITH ORDINALITY x(field, ordinal)
               WHERE field->>'sourceKey' NOT IN ('REPORT_DATE','ETD','CUTTING_PLANNING_DATE','SEWING_PLANNING_DATE','MEETING_CONDUCTED_BY')))
            WHEN source_version."code" = 'FINAL' AND source_component."type" = 'QUANTITY_RECONCILIATION'
            THEN jsonb_set(source_component."config", '{fields}',
              (SELECT jsonb_agg(CASE WHEN field->>'key' = 'quantityInspected'
                THEN field || '{"source":"SYSTEM","sourceKey":"BATCH_INSPECTED_QUANTITY"}'::jsonb
                ELSE field END ORDER BY ordinal)
               FROM jsonb_array_elements(source_component."config"->'fields') WITH ORDINALITY x(field, ordinal)))
            ELSE source_component."config" END,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      END LOOP;
    END LOOP;

    IF source_version."code" = 'PPM' THEN
      SELECT "id", COALESCE((SELECT MAX(c."sequence") FROM "quality_form_components" c WHERE c."quality_form_section_id" = s."id"), 0) + 1
      INTO new_section_id, next_sequence FROM "quality_form_sections" s WHERE s."quality_form_version_id" = new_version_id ORDER BY s."sequence" LIMIT 1;
      INSERT INTO "quality_form_components" ("id", "quality_form_section_id", "sequence", "type", "title", "config", "created_at", "updated_at")
      VALUES ('qfc_workflow_' || md5(new_version_id || 'meeting-details'), new_section_id, next_sequence, 'FIELD_GROUP', 'Meeting details',
        '{"fields":[{"key":"meetingDate","label":"Meeting Date","dataType":"DATE","source":"USER","required":true},{"key":"meetingConductedBy","label":"Meeting Conducted By","dataType":"TEXT","source":"USER","required":true},{"key":"deliveryDate","label":"Delivery Date","dataType":"DATE","source":"USER"},{"key":"cuttingPlanningDate","label":"Cutting Planning Date","dataType":"DATE","source":"USER"},{"key":"sewingPlanningDate","label":"Sewing Planning Date","dataType":"DATE","source":"USER"}]}'::jsonb,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    ELSE
      SELECT "id", COALESCE((SELECT MAX(c."sequence") FROM "quality_form_components" c WHERE c."quality_form_section_id" = s."id"), 0) + 1
      INTO new_section_id, next_sequence FROM "quality_form_sections" s WHERE s."quality_form_version_id" = new_version_id ORDER BY s."sequence" DESC LIMIT 1;
      INSERT INTO "quality_form_components" ("id", "quality_form_section_id", "sequence", "type", "title", "config", "created_at", "updated_at")
      VALUES ('qfc_workflow_' || md5(new_version_id || 'inspection-outcome'), new_section_id, next_sequence, 'INSPECTION_OUTCOME', 'Inspection conclusion', '{"allowedOutcomes":["PASS","FAIL"]}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END IF;
    UPDATE "quality_form_versions" SET "status" = 'RETIRED', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = source_version."id";
  END LOOP;
END $$;
