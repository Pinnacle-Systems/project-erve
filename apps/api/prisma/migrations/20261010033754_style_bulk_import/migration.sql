-- CreateEnum
CREATE TYPE "StyleBulkImportRunStatus" AS ENUM ('DRY_RUN', 'EXECUTED');

-- CreateEnum
CREATE TYPE "StyleBulkImportRowOutcome" AS ENUM ('COMPLETED', 'SKIPPED_EXISTING', 'IMAGE_PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "style_bulk_import_runs" (
    "id" TEXT NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_file_checksum" TEXT NOT NULL,
    "status" "StyleBulkImportRunStatus" NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_bulk_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_bulk_import_row_results" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "style_number" TEXT NOT NULL,
    "style_id" TEXT,
    "outcome" "StyleBulkImportRowOutcome" NOT NULL,
    "expected_image_checksum" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_bulk_import_row_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "style_bulk_import_runs_source_file_checksum_idx" ON "style_bulk_import_runs"("source_file_checksum");

-- CreateIndex
CREATE INDEX "style_bulk_import_row_results_run_id_idx" ON "style_bulk_import_row_results"("run_id");

-- CreateIndex
CREATE INDEX "style_bulk_import_row_results_style_number_expected_image_c_idx" ON "style_bulk_import_row_results"("style_number", "expected_image_checksum");

-- AddForeignKey
ALTER TABLE "style_bulk_import_row_results" ADD CONSTRAINT "style_bulk_import_row_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "style_bulk_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
