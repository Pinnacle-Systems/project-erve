-- DropForeignKey
ALTER TABLE "distributor_purchase_orders" DROP CONSTRAINT "distributor_purchase_orders_job_order_id_fkey";

-- DropForeignKey
ALTER TABLE "job_order_line_sizes" DROP CONSTRAINT "job_order_line_sizes_purchase_order_line_size_id_fkey";

-- DropForeignKey
ALTER TABLE "job_order_lines" DROP CONSTRAINT "job_order_lines_purchase_order_line_id_fkey";

-- DropIndex
DROP INDEX "job_order_line_sizes_job_order_line_id_purchase_order_line__key";

-- DropIndex
DROP INDEX "job_order_line_sizes_purchase_order_line_size_id_idx";

-- DropIndex
DROP INDEX "job_order_lines_job_order_id_idx";

-- DropIndex
DROP INDEX "job_order_lines_job_order_id_purchase_order_line_id_key";

-- DropIndex
DROP INDEX "job_order_lines_purchase_order_line_id_idx";

-- AlterTable
ALTER TABLE "job_order_line_sizes" DROP COLUMN "purchase_order_line_size_id";

-- AlterTable
ALTER TABLE "job_order_lines" DROP COLUMN "purchase_order_line_id";

-- AlterTable
ALTER TABLE "qa_release_lines" ALTER COLUMN "purchase_order_line_size_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "job_order_line_sizes_job_order_line_id_size_id_key" ON "job_order_line_sizes"("job_order_line_id", "size_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_order_lines_job_order_id_key" ON "job_order_lines"("job_order_id");

-- AddForeignKey
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

