/*
  Warnings:

  - You are about to drop the `price_list_lines` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `percentage_of_mrp` to the `price_lists` table without a default value. This is not possible if the table is not empty.

*/

-- INV-003: Distributor pricing becomes one effective-dated percentage of MRP
-- per Distributor, replacing per-Style absolute unit prices.
--
-- Migration safety (verified before writing this):
--   - price_list_lines/unitPrice has no runtime commercial consumer anywhere
--     in the codebase (Order Sheet, Job Order, Dispatch, Packing, Factory
--     Invoice, Erve Packing List/Dispatch, Sale/Returns) — only this module's
--     own admin UI reads or writes it.
--   - price_lists has zero rows in both local dev databases (erve_dev,
--     erve_docs) at the time this migration was written.
--   - percentage_of_mrp is added NOT NULL with no default and no backfill:
--     an already-populated price_lists table (e.g. a long-lived environment
--     this session could not inspect) makes this migration fail loudly
--     instead of silently fabricating a percentage from a legacy absolute
--     price, which would be a speculative, undocumented conversion.
-- DropForeignKey
ALTER TABLE "price_list_lines" DROP CONSTRAINT "price_list_lines_price_list_id_fkey";

-- DropForeignKey
ALTER TABLE "price_list_lines" DROP CONSTRAINT "price_list_lines_style_id_fkey";

-- AlterTable
ALTER TABLE "price_lists" ADD COLUMN     "percentage_of_mrp" DECIMAL(5,2) NOT NULL;

-- DropTable
DROP TABLE "price_list_lines";
