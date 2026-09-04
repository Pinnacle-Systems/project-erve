/*
  Warnings:

  - You are about to drop the column `distributor_sales_report_line_id` on the `invoice_handoffs` table. All the data in the column will be lost.
  - You are about to drop the column `source_type` on the `invoice_handoffs` table. All the data in the column will be lost.
  - Made the column `erve_dispatch_id` on table `invoice_handoffs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `sale_order_line_id` on table `invoice_handoffs` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "invoice_handoffs" DROP CONSTRAINT "invoice_handoffs_distributor_sales_report_line_id_fkey";

-- DropIndex
DROP INDEX "invoice_handoffs_distributor_sales_report_line_id_key";

-- DropIndex
DROP INDEX "invoice_handoffs_source_type_idx";

-- AlterTable
ALTER TABLE "invoice_handoffs" DROP COLUMN "distributor_sales_report_line_id",
DROP COLUMN "source_type",
ALTER COLUMN "erve_dispatch_id" SET NOT NULL,
ALTER COLUMN "sale_order_line_id" SET NOT NULL;

-- DropEnum
DROP TYPE "InvoiceHandoffSourceType";
