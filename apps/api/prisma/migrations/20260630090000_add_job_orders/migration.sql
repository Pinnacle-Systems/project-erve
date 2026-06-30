-- CreateEnum
CREATE TYPE "JobOrderStatus" AS ENUM ('DRAFT', 'SENT_TO_FACTORY', 'CONFIRMED_BY_FACTORY', 'IN_PRODUCTION', 'PRODUCTION_COMPLETE', 'READY_FOR_QA', 'QA_IN_PROGRESS', 'QA_PASSED', 'PARTIALLY_QA_PASSED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FactoryConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "job_orders" (
    "id" TEXT NOT NULL,
    "job_order_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "process_flow_version_id" TEXT NOT NULL,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "factory_confirmation_status" "FactoryConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "production_started_at" TIMESTAMP(3),
    "production_completed_at" TIMESTAMP(3),
    "prepared_quantity_total" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_lines" (
    "id" TEXT NOT NULL,
    "job_order_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "ordered_quantity_total" INTEGER NOT NULL,
    "prepared_quantity_total" INTEGER NOT NULL DEFAULT 0,
    "status" "JobOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_line_sizes" (
    "id" TEXT NOT NULL,
    "job_order_line_id" TEXT NOT NULL,
    "purchase_order_line_size_id" TEXT NOT NULL,
    "size_id" TEXT NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "prepared_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_order_line_sizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_order_stage_statuses" (
    "id" TEXT NOT NULL,
    "job_order_id" TEXT NOT NULL,
    "process_flow_version_stage_id" TEXT NOT NULL,
    "stage_sequence" INTEGER NOT NULL,
    "stage_name_snapshot" TEXT NOT NULL,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_order_stage_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_orders_job_order_number_key" ON "job_orders"("job_order_number");

-- CreateIndex
CREATE INDEX "job_orders_purchase_order_id_idx" ON "job_orders"("purchase_order_id");

-- CreateIndex
CREATE INDEX "job_orders_factory_id_idx" ON "job_orders"("factory_id");

-- CreateIndex
CREATE INDEX "job_orders_process_flow_version_id_idx" ON "job_orders"("process_flow_version_id");

-- CreateIndex
CREATE INDEX "job_orders_status_idx" ON "job_orders"("status");

-- CreateIndex
CREATE INDEX "job_orders_factory_confirmation_status_idx" ON "job_orders"("factory_confirmation_status");

-- CreateIndex
CREATE INDEX "job_order_lines_job_order_id_idx" ON "job_order_lines"("job_order_id");

-- CreateIndex
CREATE INDEX "job_order_lines_purchase_order_line_id_idx" ON "job_order_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "job_order_lines_style_id_idx" ON "job_order_lines"("style_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_order_lines_job_order_id_purchase_order_line_id_key" ON "job_order_lines"("job_order_id", "purchase_order_line_id");

-- CreateIndex
CREATE INDEX "job_order_line_sizes_job_order_line_id_idx" ON "job_order_line_sizes"("job_order_line_id");

-- CreateIndex
CREATE INDEX "job_order_line_sizes_purchase_order_line_size_id_idx" ON "job_order_line_sizes"("purchase_order_line_size_id");

-- CreateIndex
CREATE INDEX "job_order_line_sizes_size_id_idx" ON "job_order_line_sizes"("size_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_order_line_sizes_job_order_line_id_purchase_order_line_size_id_key" ON "job_order_line_sizes"("job_order_line_id", "purchase_order_line_size_id");

-- CreateIndex
CREATE INDEX "job_order_stage_statuses_job_order_id_idx" ON "job_order_stage_statuses"("job_order_id");

-- CreateIndex
CREATE INDEX "job_order_stage_statuses_process_flow_version_stage_id_idx" ON "job_order_stage_statuses"("process_flow_version_stage_id");

-- CreateIndex
CREATE INDEX "job_order_stage_statuses_status_idx" ON "job_order_stage_statuses"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_order_stage_statuses_job_order_id_process_flow_version_stage_id_key" ON "job_order_stage_statuses"("job_order_id", "process_flow_version_stage_id");

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "distributor_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_process_flow_version_id_fkey" FOREIGN KEY ("process_flow_version_id") REFERENCES "process_flow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "distributor_purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_lines" ADD CONSTRAINT "job_order_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_line_sizes" ADD CONSTRAINT "job_order_line_sizes_job_order_line_id_fkey" FOREIGN KEY ("job_order_line_id") REFERENCES "job_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_line_sizes" ADD CONSTRAINT "job_order_line_sizes_purchase_order_line_size_id_fkey" FOREIGN KEY ("purchase_order_line_size_id") REFERENCES "distributor_purchase_order_line_sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_line_sizes" ADD CONSTRAINT "job_order_line_sizes_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_stage_statuses" ADD CONSTRAINT "job_order_stage_statuses_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_stage_statuses" ADD CONSTRAINT "job_order_stage_statuses_process_flow_version_stage_id_fkey" FOREIGN KEY ("process_flow_version_stage_id") REFERENCES "process_flow_version_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_order_stage_statuses" ADD CONSTRAINT "job_order_stage_statuses_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
