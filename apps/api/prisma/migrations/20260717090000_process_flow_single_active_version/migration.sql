-- API mutations serialize per process flow, while this partial unique index
-- provides a final database-level guarantee that only one ACTIVE version can
-- exist for a process flow.
CREATE UNIQUE INDEX "process_flow_versions_single_active_idx"
ON "process_flow_versions" ("process_flow_id")
WHERE "status" = 'ACTIVE';
