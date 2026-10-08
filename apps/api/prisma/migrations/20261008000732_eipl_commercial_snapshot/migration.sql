-- CreateTable
CREATE TABLE "erve_packing_list_commercial_lines" (
    "id" TEXT NOT NULL,
    "erve_packing_list_id" TEXT NOT NULL,
    "sale_order_line_id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "style_mrp" DECIMAL(12,2) NOT NULL,
    "distributor_pricing_percentage" DECIMAL(5,2) NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erve_packing_list_commercial_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erve_packing_list_commercial_lines_sale_order_line_id_idx" ON "erve_packing_list_commercial_lines"("sale_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "erve_packing_list_commercial_lines_erve_packing_list_id_sal_key" ON "erve_packing_list_commercial_lines"("erve_packing_list_id", "sale_order_line_id");

-- AddForeignKey
ALTER TABLE "erve_packing_list_commercial_lines" ADD CONSTRAINT "erve_packing_list_commercial_lines_erve_packing_list_id_fkey" FOREIGN KEY ("erve_packing_list_id") REFERENCES "erve_packing_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_list_commercial_lines" ADD CONSTRAINT "erve_packing_list_commercial_lines_sale_order_line_id_fkey" FOREIGN KEY ("sale_order_line_id") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_list_commercial_lines" ADD CONSTRAINT "erve_packing_list_commercial_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erve_packing_list_commercial_lines" ADD CONSTRAINT "erve_packing_list_commercial_lines_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
