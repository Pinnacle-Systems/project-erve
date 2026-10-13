CREATE TABLE "master_import_runs" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "source_file_name" TEXT NOT NULL,
  "file_checksum" TEXT NOT NULL, "worksheet" TEXT NOT NULL, "import_version" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL, "status" TEXT NOT NULL, "summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "master_import_runs_kind_check" CHECK ("kind" IN ('factories', 'distributors', 'retail-stores'))
);
CREATE INDEX "master_import_runs_kind_created_at_idx" ON "master_import_runs"("kind", "created_at");
CREATE TABLE "master_import_row_results" (
  "id" TEXT PRIMARY KEY, "run_id" TEXT NOT NULL, "row_number" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL, "master_id" TEXT, "code" TEXT, "detail" TEXT, "payload" JSONB NOT NULL,
  CONSTRAINT "master_import_row_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "master_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "master_import_row_results_outcome_check" CHECK ("outcome" IN ('CREATE','SKIP_EXISTING','NEEDS_REVIEW','REJECTED','FAILED'))
);
CREATE UNIQUE INDEX "master_import_row_results_run_id_row_number_key" ON "master_import_row_results"("run_id", "row_number");
CREATE TABLE "master_import_sources" (
  "id" TEXT PRIMARY KEY, "kind" TEXT NOT NULL, "source_key" TEXT NOT NULL, "business_identity" TEXT NOT NULL,
  "master_id" TEXT NOT NULL, "original_input" JSONB NOT NULL, "run_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "master_import_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "master_import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "master_import_sources_kind_source_key_key" ON "master_import_sources"("kind", "source_key");
CREATE UNIQUE INDEX "master_import_sources_kind_business_identity_key" ON "master_import_sources"("kind", "business_identity");
