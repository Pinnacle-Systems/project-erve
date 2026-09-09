-- AlterEnum
ALTER TYPE "ErvePackingListStatus" ADD VALUE 'FINALIZED';

-- AlterTable
ALTER TABLE "erve_dispatches" ALTER COLUMN "sale_order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "erve_packing_lists" ADD COLUMN     "destination_address_line1" TEXT,
ADD COLUMN     "destination_address_line2" TEXT,
ADD COLUMN     "destination_city" TEXT,
ADD COLUMN     "destination_contact_email" TEXT,
ADD COLUMN     "destination_contact_name" TEXT,
ADD COLUMN     "destination_contact_phone" TEXT,
ADD COLUMN     "destination_country" TEXT,
ADD COLUMN     "destination_label" TEXT,
ADD COLUMN     "destination_match_key" TEXT,
ADD COLUMN     "destination_postal_code" TEXT,
ADD COLUMN     "destination_state" TEXT,
ADD COLUMN     "distributor_id" TEXT,
ADD COLUMN     "finalized_at" TIMESTAMP(3),
ADD COLUMN     "finalized_by_id" TEXT,
ADD COLUMN     "origin_destination_id" TEXT,
ALTER COLUMN "sale_order_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "factory_packing_cartons" ADD COLUMN     "erve_packing_list_id" TEXT;

-- CreateIndex
CREATE INDEX "erve_packing_lists_distributor_id_status_idx" ON "erve_packing_lists"("distributor_id", "status");

-- CreateIndex
CREATE INDEX "factory_packing_cartons_erve_packing_list_id_idx" ON "factory_packing_cartons"("erve_packing_list_id");

-- AddForeignKey
ALTER TABLE "factory_packing_cartons" ADD CONSTRAINT "factory_packing_cartons_erve_packing_list_id_fkey" FOREIGN KEY ("erve_packing_list_id") REFERENCES "erve_packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_origin_destination_id_fkey" FOREIGN KEY ("origin_destination_id") REFERENCES "sale_order_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_lists" ADD CONSTRAINT "erve_packing_lists_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
