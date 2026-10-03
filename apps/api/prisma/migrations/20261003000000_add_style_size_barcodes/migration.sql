-- Additive: both columns are nullable, so existing rows are untouched and no
-- backfill is required to apply this migration. Postgres allows many NULLs
-- under a unique index; uniqueness is enforced as values are assigned.

-- AlterTable
ALTER TABLE "seasons" ADD COLUMN     "barcode_serial" INTEGER;

-- AlterTable
ALTER TABLE "style_sizes" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "seasons_barcode_serial_key" ON "seasons"("barcode_serial");

-- CreateIndex
CREATE UNIQUE INDEX "style_sizes_barcode_key" ON "style_sizes"("barcode");
