-- CreateEnum
CREATE TYPE "FinalQualityBatchReworkStatus" AS ENUM ('REQUIRED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "final_quality_batch_reworks" (
    "id" TEXT NOT NULL,
    "final_quality_batch_id" TEXT NOT NULL,
    "failed_quality_execution_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "status" "FinalQualityBatchReworkStatus" NOT NULL DEFAULT 'REQUIRED',
    "acknowledged_by_id" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "started_by_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "final_quality_batch_reworks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "final_quality_batch_reworks_failed_quality_execution_id_key" ON "final_quality_batch_reworks"("failed_quality_execution_id");

-- CreateIndex
CREATE INDEX "final_quality_batch_rework_state_idx" ON "final_quality_batch_reworks"("final_quality_batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "final_quality_batch_rework_cycle_key" ON "final_quality_batch_reworks"("final_quality_batch_id", "cycle_number");

-- AddForeignKey
ALTER TABLE "final_quality_batch_reworks" ADD CONSTRAINT "final_quality_batch_reworks_final_quality_batch_id_fkey" FOREIGN KEY ("final_quality_batch_id") REFERENCES "final_quality_batches"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "final_quality_batch_reworks" ADD CONSTRAINT "final_quality_batch_reworks_failed_quality_execution_id_fkey" FOREIGN KEY ("failed_quality_execution_id") REFERENCES "quality_activity_executions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "final_quality_batch_reworks" ADD CONSTRAINT "final_quality_batch_reworks_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "final_quality_batch_reworks" ADD CONSTRAINT "final_quality_batch_reworks_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "final_quality_batch_reworks" ADD CONSTRAINT "final_quality_batch_reworks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backfill: batches that failed Final inspection before this feature existed
-- have no rework history. Give each an initial cycle 1 in REQUIRED status,
-- anchored to its latest finalized FAIL attempt, so it surfaces to Factory
-- exactly like a brand-new FAIL would. We deliberately do NOT fabricate an
-- acknowledged/started/completed history that never happened — unresolved
-- historical batches simply start their (real, going-forward) rework cycle
-- from REQUIRED.
INSERT INTO "final_quality_batch_reworks"
  ("id", "final_quality_batch_id", "failed_quality_execution_id", "cycle_number", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  b."id",
  latest_fail."id",
  1,
  'REQUIRED',
  now(),
  now()
FROM "final_quality_batches" b
JOIN LATERAL (
  SELECT e."id"
  FROM "quality_activity_executions" e
  WHERE e."final_quality_batch_id" = b."id"
    AND e."status" = 'FINALIZED'
    AND e."outcome" = 'FAIL'
  ORDER BY e."attempt_number" DESC
  LIMIT 1
) latest_fail ON true
WHERE b."disposition" = 'AWAITING_REINSPECTION'
  AND NOT EXISTS (
    SELECT 1 FROM "final_quality_batch_reworks" r WHERE r."final_quality_batch_id" = b."id"
  );
