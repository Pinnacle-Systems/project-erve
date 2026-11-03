-- AlterTable
-- Optional GSTIN for Factories. Additive and nullable: existing rows keep NULL.
ALTER TABLE "factories" ADD COLUMN "gstin" TEXT;
