-- CreateEnum
CREATE TYPE "HsnStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GstRuleSetStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "GstRuleSetVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED');

-- AlterTable
ALTER TABLE "styles" ADD COLUMN     "hsn_id" TEXT;

-- CreateTable
CREATE TABLE "hsns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" "HsnStatus" NOT NULL DEFAULT 'ACTIVE',
    "gst_rule_set_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hsns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_rule_sets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "GstRuleSetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_rule_set_versions" (
    "id" TEXT NOT NULL,
    "gst_rule_set_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "GstRuleSetVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_rule_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_value_bands" (
    "id" TEXT NOT NULL,
    "gst_rule_set_version_id" TEXT NOT NULL,
    "min_value" DECIMAL(12,2),
    "max_value" DECIMAL(12,2),
    "gst_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_value_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hsns_code_key" ON "hsns"("code");

-- CreateIndex
CREATE INDEX "hsns_status_idx" ON "hsns"("status");

-- CreateIndex
CREATE INDEX "hsns_gst_rule_set_id_idx" ON "hsns"("gst_rule_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "gst_rule_sets_code_key" ON "gst_rule_sets"("code");

-- CreateIndex
CREATE INDEX "gst_rule_sets_status_idx" ON "gst_rule_sets"("status");

-- CreateIndex
CREATE INDEX "gst_rule_set_versions_gst_rule_set_id_idx" ON "gst_rule_set_versions"("gst_rule_set_id");

-- CreateIndex
CREATE INDEX "gst_rule_set_versions_status_idx" ON "gst_rule_set_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "gst_rule_set_versions_gst_rule_set_id_version_number_key" ON "gst_rule_set_versions"("gst_rule_set_id", "version_number");

-- CreateIndex
CREATE INDEX "gst_value_bands_gst_rule_set_version_id_idx" ON "gst_value_bands"("gst_rule_set_version_id");

-- CreateIndex
CREATE INDEX "styles_hsn_id_idx" ON "styles"("hsn_id");

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_hsn_id_fkey" FOREIGN KEY ("hsn_id") REFERENCES "hsns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsns" ADD CONSTRAINT "hsns_gst_rule_set_id_fkey" FOREIGN KEY ("gst_rule_set_id") REFERENCES "gst_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_rule_set_versions" ADD CONSTRAINT "gst_rule_set_versions_gst_rule_set_id_fkey" FOREIGN KEY ("gst_rule_set_id") REFERENCES "gst_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_value_bands" ADD CONSTRAINT "gst_value_bands_gst_rule_set_version_id_fkey" FOREIGN KEY ("gst_rule_set_version_id") REFERENCES "gst_rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- HSN codes are canonical identity here, so the database enforces the same
-- 8-digit numeric shape the application has always required at the point of
-- entry (master-data.validation.ts hsnCodeSchema).
ALTER TABLE "hsns" ADD CONSTRAINT "hsns_code_is_8_digits"
  CHECK ("code" ~ '^[0-9]{8}$');

-- Value bands are non-negative and, when both bounds are present, strictly
-- increasing. min_value is always EXCLUSIVE and max_value always INCLUSIVE
-- (see the GstValueBand doc comment in schema.prisma) — this is what makes
-- "exactly 2500 resolves to 5%, not 18%" unambiguous without a min+0.01
-- boundary trick.
ALTER TABLE "gst_value_bands" ADD CONSTRAINT "gst_value_bands_min_value_non_negative"
  CHECK ("min_value" IS NULL OR "min_value" >= 0);

ALTER TABLE "gst_value_bands" ADD CONSTRAINT "gst_value_bands_max_value_non_negative"
  CHECK ("max_value" IS NULL OR "max_value" >= 0);

ALTER TABLE "gst_value_bands" ADD CONSTRAINT "gst_value_bands_range_valid"
  CHECK ("min_value" IS NULL OR "max_value" IS NULL OR "max_value" > "min_value");

ALTER TABLE "gst_value_bands" ADD CONSTRAINT "gst_value_bands_gst_percent_valid"
  CHECK ("gst_percent" >= 0 AND "gst_percent" <= 100);

-- Effective periods are inclusive day ranges, mirroring
-- price_lists_effective_period_valid: effective_to may be NULL (open-ended)
-- but can never precede effective_from, and a bounded period requires a
-- start date.
ALTER TABLE "gst_rule_set_versions" ADD CONSTRAINT "gst_rule_set_versions_effective_period_valid"
  CHECK ("effective_to" IS NULL OR ("effective_from" IS NOT NULL AND "effective_to" >= "effective_from"));

-- An ACTIVE version must have a start date, otherwise date lookups against
-- it would be undefined (mirrors price_lists_active_requires_effective_from).
ALTER TABLE "gst_rule_set_versions" ADD CONSTRAINT "gst_rule_set_versions_active_requires_effective_from"
  CHECK ("status" <> 'ACTIVE' OR "effective_from" IS NOT NULL);

-- At most one ACTIVE version per GST Rule Set may cover any given date —
-- the database-level backstop behind the application's overlap checks, same
-- pattern as price_lists_no_overlapping_active_periods. btree_gist is needed
-- for equality on gst_rule_set_id inside a GiST exclusion constraint
-- (trusted extension, no superuser required on PostgreSQL 13+; already
-- created by the price_list_distributor_pricing migration if that ran
-- first, hence IF NOT EXISTS).
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "gst_rule_set_versions" ADD CONSTRAINT "gst_rule_set_versions_no_overlapping_active_periods"
  EXCLUDE USING gist (
    "gst_rule_set_id" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  ) WHERE ("status" = 'ACTIVE');
