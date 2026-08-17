CREATE TYPE "ProcessFlowActivityType" AS ENUM ('PRODUCTION', 'QUALITY');
CREATE TYPE "QualityExecutionMode" AS ENUM ('SEQUENTIAL_GATE', 'IN_PROCESS');
CREATE TYPE "QualityAvailabilityPolicy" AS ENUM ('WHILE_ASSOCIATED_ACTIVITY_ACTIVE', 'PROGRESS_PERCENTAGE');

ALTER TABLE "process_flow_version_stages"
  ADD COLUMN "activity_type" "ProcessFlowActivityType" NOT NULL DEFAULT 'PRODUCTION',
  ADD COLUMN "quality_form_version_id" TEXT,
  ADD COLUMN "quality_execution_mode" "QualityExecutionMode",
  ADD COLUMN "associated_production_activity_id" TEXT,
  ADD COLUMN "quality_availability_policy" "QualityAvailabilityPolicy",
  ADD COLUMN "progress_threshold_percent" DECIMAL(5,2);

ALTER TABLE "process_flow_version_stages"
  ADD CONSTRAINT "process_flow_activity_configuration_check" CHECK (
    ("activity_type" = 'PRODUCTION'
      AND "quality_form_version_id" IS NULL
      AND "quality_execution_mode" IS NULL
      AND "associated_production_activity_id" IS NULL
      AND "quality_availability_policy" IS NULL
      AND "progress_threshold_percent" IS NULL)
    OR
    ("activity_type" = 'QUALITY'
      AND "quality_form_version_id" IS NOT NULL
      AND "quality_execution_mode" IS NOT NULL
      AND (
        ("quality_execution_mode" = 'SEQUENTIAL_GATE'
          AND "associated_production_activity_id" IS NULL
          AND "quality_availability_policy" IS NULL
          AND "progress_threshold_percent" IS NULL)
        OR
        ("quality_execution_mode" = 'IN_PROCESS'
          AND "associated_production_activity_id" IS NOT NULL
          AND "quality_availability_policy" IS NOT NULL
          AND (
            ("quality_availability_policy" = 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
              AND "progress_threshold_percent" IS NULL)
            OR
            ("quality_availability_policy" = 'PROGRESS_PERCENTAGE'
              AND "progress_threshold_percent" IS NOT NULL
              AND "progress_threshold_percent" > 0
              AND "progress_threshold_percent" <= 100)
          ))
      ))
  ),
  ADD CONSTRAINT "process_flow_activity_not_self_associated_check"
    CHECK ("associated_production_activity_id" IS NULL OR "associated_production_activity_id" <> "id"),
  ADD CONSTRAINT "process_flow_activity_quality_form_version_fkey"
    FOREIGN KEY ("quality_form_version_id") REFERENCES "quality_form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "process_flow_activity_associated_production_fkey"
    FOREIGN KEY ("associated_production_activity_id") REFERENCES "process_flow_version_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "process_flow_version_stages_quality_form_version_id_idx"
  ON "process_flow_version_stages"("quality_form_version_id");
CREATE INDEX "process_flow_version_stages_associated_production_activity_id_idx"
  ON "process_flow_version_stages"("associated_production_activity_id");
CREATE INDEX "process_flow_version_stages_activity_type_idx"
  ON "process_flow_version_stages"("activity_type");

CREATE FUNCTION "enforce_process_flow_production_association"() RETURNS trigger AS $$
BEGIN
  IF NEW."associated_production_activity_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "process_flow_version_stages" associated
    WHERE associated."id" = NEW."associated_production_activity_id"
      AND associated."process_flow_version_id" = NEW."process_flow_version_id"
      AND associated."activity_type" = 'PRODUCTION'
  ) THEN
    RAISE EXCEPTION 'Associated activity must be a Production activity in the same Process Flow version'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "process_flow_production_association_trigger"
  BEFORE INSERT OR UPDATE OF "associated_production_activity_id", "process_flow_version_id", "activity_type"
  ON "process_flow_version_stages"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_process_flow_production_association"();
