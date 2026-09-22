-- CreateEnum
CREATE TYPE "RecordOrigin" AS ENUM ('LIVE_WORKFLOW', 'HISTORICAL_IMPORT');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "HistoricalDocumentType" AS ENUM ('HISTORICAL_FACTORY_ORDER', 'FACTORY_INVOICE', 'FACTORY_PACKING_DISPATCH', 'ERVE_CUSTOMER_INVOICE', 'DELIVERY_POD', 'OTHER');

-- CreateEnum
CREATE TYPE "HistoricalDocumentRelationshipType" AS ENUM ('PRIMARY_SOURCE', 'SUPPORTING_DOCUMENT', 'OTHER');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'HISTORICAL_JOB_ORDER';

-- AlterTable
ALTER TABLE "job_orders" ADD COLUMN     "historical_business_date" DATE,
ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "imported_at" TIMESTAMP(3),
ADD COLUMN     "imported_by_id" TEXT,
ADD COLUMN     "legacy_reference_number" TEXT,
ADD COLUMN     "migration_notes" TEXT,
ADD COLUMN     "record_origin" "RecordOrigin" NOT NULL DEFAULT 'LIVE_WORKFLOW',
ALTER COLUMN "job_order_serial" DROP NOT NULL;

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "source_label" TEXT NOT NULL,
    "started_by_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "process_flow_version_id" TEXT,
    "notes" TEXT,
    "total_source_documents" INTEGER NOT NULL DEFAULT 0,
    "ready_count" INTEGER NOT NULL DEFAULT 0,
    "review_required_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_documents" (
    "id" TEXT NOT NULL,
    "document_type" "HistoricalDocumentType" NOT NULL,
    "external_reference" TEXT,
    "document_date" DATE,
    "file_id" TEXT NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "import_batch_id" TEXT,
    "added_by_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "historical_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_document_job_orders" (
    "id" TEXT NOT NULL,
    "historical_document_id" TEXT NOT NULL,
    "job_order_id" TEXT NOT NULL,
    "relationship_type" "HistoricalDocumentRelationshipType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_document_job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historical_documents_import_batch_id_idx" ON "historical_documents"("import_batch_id");

-- CreateIndex
CREATE INDEX "historical_documents_external_reference_idx" ON "historical_documents"("external_reference");

-- CreateIndex
CREATE INDEX "historical_document_job_orders_job_order_id_idx" ON "historical_document_job_orders"("job_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "historical_document_job_orders_historical_document_id_job_o_key" ON "historical_document_job_orders"("historical_document_id", "job_order_id");

-- CreateIndex
CREATE INDEX "job_orders_record_origin_idx" ON "job_orders"("record_origin");

-- CreateIndex
CREATE INDEX "job_orders_legacy_reference_number_idx" ON "job_orders"("legacy_reference_number");

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_imported_by_id_fkey" FOREIGN KEY ("imported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_started_by_id_fkey" FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_process_flow_version_id_fkey" FOREIGN KEY ("process_flow_version_id") REFERENCES "process_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_documents" ADD CONSTRAINT "historical_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_documents" ADD CONSTRAINT "historical_documents_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_documents" ADD CONSTRAINT "historical_documents_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_document_job_orders" ADD CONSTRAINT "historical_document_job_orders_historical_document_id_fkey" FOREIGN KEY ("historical_document_id") REFERENCES "historical_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_document_job_orders" ADD CONSTRAINT "historical_document_job_orders_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
