-- Remove the obsolete internal "Factory Rework" state machine
-- (FinalQualityBatchRework / FinalQualityBatchReworkStatus) that
-- previously gated QA's Final Quality Batch reinspection.
--
-- Business correction: physical Factory correction/rework happens outside
-- ERVE. QA reinspection eligibility is now derived directly from
-- FinalQualityBatch.disposition and QualityActivityExecution attempt
-- state (see quality-executions.service.ts startFinalBatchReinspection),
-- with no dependency on this model. There is no live production history
-- to preserve here — every row in this table existed only to drive the
-- now-removed acknowledge/start/complete workflow, so its audit value is
-- fully superseded by the existing FINAL_INSPECTION_BATCH_FINALIZED /
-- FINAL_INSPECTION_REINSPECTION_STARTED audit trail on the batch itself.
-- Dropped outright rather than kept as inert legacy schema.

-- DropForeignKey
ALTER TABLE "final_quality_batch_reworks" DROP CONSTRAINT "final_quality_batch_reworks_final_quality_batch_id_fkey";
ALTER TABLE "final_quality_batch_reworks" DROP CONSTRAINT "final_quality_batch_reworks_failed_quality_execution_id_fkey";
ALTER TABLE "final_quality_batch_reworks" DROP CONSTRAINT "final_quality_batch_reworks_acknowledged_by_id_fkey";
ALTER TABLE "final_quality_batch_reworks" DROP CONSTRAINT "final_quality_batch_reworks_started_by_id_fkey";
ALTER TABLE "final_quality_batch_reworks" DROP CONSTRAINT "final_quality_batch_reworks_completed_by_id_fkey";

-- DropTable
DROP TABLE "final_quality_batch_reworks";

-- DropEnum
DROP TYPE "FinalQualityBatchReworkStatus";
