CREATE TYPE "QualityFormStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "QualityFormActivityType" AS ENUM ('MEETING', 'INSPECTION');
CREATE TYPE "QualityFormExecutionScope" AS ENUM ('JOB_ORDER', 'SIZE');
CREATE TYPE "QualityFormVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "QualityFormComponentType" AS ENUM ('SYSTEM_CONTEXT', 'FIELD_GROUP', 'ATTENDEE_LIST', 'ACTION_LIST', 'CHECKLIST', 'AQL_RESULT', 'PRODUCTION_PROGRESS', 'DEFECT_LIST', 'CORRECTIVE_ACTIONS', 'TEST_RESULTS', 'COMMENTS', 'ATTACHMENTS', 'SIGNATURES', 'QUANTITY_RECONCILIATION', 'INSPECTION_OUTCOME');

CREATE TABLE "quality_forms" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "QualityFormStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_forms_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT "quality_forms_name_not_blank" CHECK (btrim("name") <> '')
);
CREATE UNIQUE INDEX "quality_forms_code_key" ON "quality_forms"("code");
CREATE INDEX "quality_forms_status_idx" ON "quality_forms"("status");

CREATE TABLE "quality_form_versions" (
  "id" TEXT NOT NULL,
  "quality_form_id" TEXT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "activity_type" "QualityFormActivityType" NOT NULL,
  "execution_scope" "QualityFormExecutionScope" NOT NULL,
  "status" "QualityFormVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_form_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_form_versions_number_positive" CHECK ("version_number" > 0),
  CONSTRAINT "quality_form_versions_published_at_consistent" CHECK (("status" = 'DRAFT' AND "published_at" IS NULL) OR ("status" <> 'DRAFT' AND "published_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "quality_form_versions_quality_form_id_version_number_key" ON "quality_form_versions"("quality_form_id", "version_number");
CREATE INDEX "quality_form_versions_quality_form_id_idx" ON "quality_form_versions"("quality_form_id");
CREATE INDEX "quality_form_versions_status_idx" ON "quality_form_versions"("status");
CREATE INDEX "quality_form_versions_activity_type_idx" ON "quality_form_versions"("activity_type");
CREATE INDEX "quality_form_versions_execution_scope_idx" ON "quality_form_versions"("execution_scope");

CREATE TABLE "quality_form_sections" (
  "id" TEXT NOT NULL,
  "quality_form_version_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_form_sections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_form_sections_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "quality_form_sections_title_not_blank" CHECK (btrim("title") <> '')
);
CREATE UNIQUE INDEX "quality_form_sections_quality_form_version_id_sequence_key" ON "quality_form_sections"("quality_form_version_id", "sequence");
CREATE INDEX "quality_form_sections_quality_form_version_id_idx" ON "quality_form_sections"("quality_form_version_id");

CREATE TABLE "quality_form_components" (
  "id" TEXT NOT NULL,
  "quality_form_section_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "QualityFormComponentType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "config" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_form_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_form_components_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "quality_form_components_title_not_blank" CHECK (btrim("title") <> ''),
  CONSTRAINT "quality_form_components_config_object" CHECK (jsonb_typeof("config") = 'object')
);
CREATE UNIQUE INDEX "quality_form_components_quality_form_section_id_sequence_key" ON "quality_form_components"("quality_form_section_id", "sequence");
CREATE INDEX "quality_form_components_quality_form_section_id_idx" ON "quality_form_components"("quality_form_section_id");
CREATE INDEX "quality_form_components_type_idx" ON "quality_form_components"("type");

ALTER TABLE "quality_form_versions" ADD CONSTRAINT "quality_form_versions_quality_form_id_fkey" FOREIGN KEY ("quality_form_id") REFERENCES "quality_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_form_sections" ADD CONSTRAINT "quality_form_sections_quality_form_version_id_fkey" FOREIGN KEY ("quality_form_version_id") REFERENCES "quality_form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quality_form_components" ADD CONSTRAINT "quality_form_components_quality_form_section_id_fkey" FOREIGN KEY ("quality_form_section_id") REFERENCES "quality_form_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one published version can be current for a form. Historical
-- published versions are retired when a newer draft is published.
CREATE UNIQUE INDEX "quality_form_versions_one_published" ON "quality_form_versions"("quality_form_id") WHERE "status" = 'PUBLISHED';
