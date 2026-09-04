-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "gstin" TEXT;

-- Backfill: distributors created before GSTIN capture was mandatory have no
-- real value on file. Flag them with an obvious placeholder so NOT NULL can
-- be enforced without fabricating a valid-looking tax ID — each should be
-- corrected via the distributor edit form.
UPDATE "distributors" SET "gstin" = 'PENDING-GSTIN' WHERE "gstin" IS NULL;

-- AlterTable
ALTER TABLE "distributors" ALTER COLUMN "gstin" SET NOT NULL;
