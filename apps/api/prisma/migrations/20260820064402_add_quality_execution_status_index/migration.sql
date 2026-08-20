-- Supports draft recovery and finalized-batch aggregation by job order activity.
CREATE INDEX "quality_execution_status_idx"
ON "quality_activity_executions"("job_order_id", "process_flow_activity_id", "status");
