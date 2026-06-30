-- Align hand-written index names with Prisma's generated names so
-- `prisma migrate dev` does not keep proposing this rename.
ALTER INDEX "job_order_line_sizes_job_order_line_id_purchase_order_line_size"
  RENAME TO "job_order_line_sizes_job_order_line_id_purchase_order_line__key";

ALTER INDEX "job_order_stage_statuses_job_order_id_process_flow_version_stag"
  RENAME TO "job_order_stage_statuses_job_order_id_process_flow_version__key";
