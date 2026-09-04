-- AlterEnum
ALTER TYPE "SaleOrderStatus" ADD VALUE 'FULFILLED';

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "fulfilled_at" TIMESTAMP(3),
ADD COLUMN     "fulfilled_by_id" TEXT,
ADD COLUMN     "fulfillment_reference" TEXT;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_fulfilled_by_id_fkey" FOREIGN KEY ("fulfilled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
