CREATE TYPE "QualityGateSatisfactionRequirement" AS ENUM ('FINALIZED', 'OUTCOME_PASS');
CREATE TYPE "QualityExecutionMultiplicity" AS ENUM ('SINGLE', 'BATCHED');
CREATE TYPE "QualityCoverageTarget" AS ENUM ('PREPARED_QUANTITY');
ALTER TABLE "process_flow_version_stages" DROP CONSTRAINT "process_flow_activity_configuration_check";
ALTER TABLE "process_flow_version_stages"
  ADD COLUMN "gate_satisfaction_requirement" "QualityGateSatisfactionRequirement",
  ADD COLUMN "execution_multiplicity" "QualityExecutionMultiplicity",
  ADD COLUMN "coverage_target" "QualityCoverageTarget";
UPDATE "process_flow_version_stages"
SET "gate_satisfaction_requirement" = CASE WHEN "quality_execution_mode" = 'SEQUENTIAL_GATE' THEN 'FINALIZED'::"QualityGateSatisfactionRequirement" END,
    "execution_multiplicity" = CASE WHEN "activity_type" = 'QUALITY' THEN 'SINGLE'::"QualityExecutionMultiplicity" END;
ALTER TABLE "process_flow_version_stages" ADD CONSTRAINT "process_flow_activity_configuration_check" CHECK (
  ("activity_type" = 'PRODUCTION' AND "quality_form_version_id" IS NULL AND "quality_execution_mode" IS NULL
    AND "associated_production_activity_id" IS NULL AND "quality_availability_policy" IS NULL
    AND "progress_threshold_percent" IS NULL AND "gate_satisfaction_requirement" IS NULL
    AND "execution_multiplicity" IS NULL AND "coverage_target" IS NULL)
  OR
  ("activity_type" = 'QUALITY' AND "quality_form_version_id" IS NOT NULL
    AND "quality_execution_mode" IS NOT NULL AND "execution_multiplicity" IS NOT NULL
    AND (("execution_multiplicity" = 'SINGLE' AND "coverage_target" IS NULL)
      OR ("execution_multiplicity" = 'BATCHED' AND "coverage_target" = 'PREPARED_QUANTITY'))
    AND (("quality_execution_mode" = 'SEQUENTIAL_GATE'
      AND "gate_satisfaction_requirement" IS NOT NULL
      AND "associated_production_activity_id" IS NULL AND "quality_availability_policy" IS NULL
      AND "progress_threshold_percent" IS NULL AND "execution_multiplicity" = 'SINGLE')
    OR ("quality_execution_mode" = 'IN_PROCESS' AND "gate_satisfaction_requirement" IS NULL
      AND "associated_production_activity_id" IS NOT NULL AND "quality_availability_policy" IS NOT NULL
      AND (("quality_availability_policy" IN ('WHILE_ASSOCIATED_ACTIVITY_ACTIVE', 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES')
        AND "progress_threshold_percent" IS NULL)
      OR ("quality_availability_policy" = 'PROGRESS_PERCENTAGE' AND "progress_threshold_percent" IS NOT NULL AND "progress_threshold_percent" > 0
        AND "progress_threshold_percent" <= 100)))))
);
