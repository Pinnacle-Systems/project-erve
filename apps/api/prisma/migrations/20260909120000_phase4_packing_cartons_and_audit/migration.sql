-- DropForeignKey
ALTER TABLE "factory_packing_carton_lines" DROP CONSTRAINT "factory_packing_carton_lines_factory_dispatch_line_id_fkey";

-- DropIndex
DROP INDEX "factory_packing_carton_lines_carton_id_factory_dispatch_lin_key";

-- DropIndex
DROP INDEX "factory_packing_carton_lines_factory_dispatch_line_id_idx";

-- AlterTable
ALTER TABLE "factory_packing_carton_lines" DROP COLUMN "factory_dispatch_line_id",
ADD COLUMN     "sale_order_line_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "factory_packing_cartons" ADD COLUMN     "created_by_id" TEXT NOT NULL,
ADD COLUMN     "destination_id" TEXT NOT NULL,
ADD COLUMN     "retired_at" TIMESTAMP(3),
ADD COLUMN     "retired_by_id" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "factory_packing_carton_audits" (
    "id" TEXT NOT NULL,
    "carton_id" TEXT NOT NULL,
    "carton_version" INTEGER NOT NULL,
    "inspected_by_id" TEXT NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_packing_carton_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_packing_carton_audits_carton_id_carton_version_key" ON "factory_packing_carton_audits"("carton_id", "carton_version");

-- CreateIndex
CREATE INDEX "factory_packing_carton_lines_sale_order_line_id_idx" ON "factory_packing_carton_lines"("sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "factory_packing_carton_lines_carton_id_sale_order_line_id_key" ON "factory_packing_carton_lines"("carton_id", "sale_order_line_id");

-- CreateIndex
CREATE INDEX "factory_packing_cartons_factory_dispatch_id_destination_id_idx" ON "factory_packing_cartons"("factory_dispatch_id", "destination_id");

-- AddForeignKey
ALTER TABLE "factory_packing_cartons" ADD CONSTRAINT "factory_packing_cartons_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "sale_order_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_cartons" ADD CONSTRAINT "factory_packing_cartons_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_cartons" ADD CONSTRAINT "factory_packing_cartons_retired_by_id_fkey" FOREIGN KEY ("retired_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_carton_lines" ADD CONSTRAINT "factory_packing_carton_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_carton_audits" ADD CONSTRAINT "factory_packing_carton_audits_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "factory_packing_cartons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_packing_carton_audits" ADD CONSTRAINT "factory_packing_carton_audits_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

