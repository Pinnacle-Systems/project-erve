/*
  Warnings:

  - Made the column `distributor_id` on table `price_lists` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "price_lists" DROP CONSTRAINT "price_lists_distributor_id_fkey";

-- AlterTable
ALTER TABLE "price_lists" ALTER COLUMN "distributor_id" SET NOT NULL,
ALTER COLUMN "effective_from" SET DATA TYPE DATE,
ALTER COLUMN "effective_to" SET DATA TYPE DATE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Effective periods are inclusive day ranges: effective_to may be NULL
-- (open-ended) but can never precede effective_from, and a bounded period
-- requires a start date.
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_effective_period_valid"
  CHECK ("effective_to" IS NULL OR ("effective_from" IS NOT NULL AND "effective_to" >= "effective_from"));

-- An ACTIVE price list must have a start date, otherwise date lookups
-- against it would be undefined.
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_active_requires_effective_from"
  CHECK ("status" <> 'ACTIVE' OR "effective_from" IS NOT NULL);

-- At most one ACTIVE price list per distributor may cover any given date.
-- This is the database-level backstop for the application's overlap checks:
-- even two concurrent activations that both pass validation cannot commit
-- overlapping ACTIVE periods. btree_gist is needed for equality on
-- distributor_id inside a GiST exclusion constraint (trusted extension,
-- no superuser required on PostgreSQL 13+).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_no_overlapping_active_periods"
  EXCLUDE USING gist (
    "distributor_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');
