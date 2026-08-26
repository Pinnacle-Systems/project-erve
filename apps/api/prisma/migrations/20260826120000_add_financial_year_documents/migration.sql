-- Financial Year infrastructure: a single authoritative FinancialYear master
-- (1-Apr - 31-Mar), a FY-scoped DocumentSequence high-water mark for
-- Purchase Order / Job Order numbering, and Season's free-text
-- financial_year converted to a real relation.
--
-- Unlike ERVE-016's original Season code/name migration (which intentionally
-- performed NO backfill, because a short operational code/name cannot be
-- safely guessed), Financial Year is deterministically computable from data
-- that already exists on every row (po_date, job order created_at, Season's
-- existing financial_year text) - nothing is invented, so a real backfill is
-- safe and performed here in one self-contained transactional migration.
--
-- The April-March fiscal rule is duplicated in this file's SQL as the one
-- sanctioned exception to "centralize it in financial-year.util.ts" - a
-- migration must be a frozen, self-contained historical artifact and cannot
-- call application TypeScript. It must never be duplicated anywhere else.
--
-- Historical poNumber / jobOrderNumber strings are never rewritten by this
-- migration. The po_serial / job_order_serial columns populated below are
-- internal bookkeeping values only, assigned by ROW_NUMBER() over each
-- Financial Year's rows - they do not reproduce or relate to the legacy
-- calendar-year-scoped suffix already embedded in those visible numbers.

-- =====================================================================
-- 1) Financial Year infrastructure
-- =====================================================================

CREATE TYPE "DocumentType" AS ENUM ('PURCHASE_ORDER', 'JOB_ORDER');

CREATE TABLE "financial_years" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "financial_years_code_key" UNIQUE ("code"),
  CONSTRAINT "financial_years_period_valid" CHECK ("end_date" > "start_date")
);

-- Guarantees a business date resolves to exactly one Financial Year at the
-- database level, mirroring the PriceList non-overlapping-active-period
-- precedent (20260717005255_price_list_distributor_pricing). Unconditional
-- here (every row must be non-overlapping, not just "active" ones).
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_no_overlapping_periods"
  EXCLUDE USING gist (daterange("start_date", "end_date", '[]') WITH &&);

CREATE TABLE "document_sequences" (
  "id" TEXT NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "financial_year_id" TEXT NOT NULL,
  "last_allocated_serial" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_sequences_document_type_financial_year_id_key" UNIQUE ("document_type", "financial_year_id"),
  CONSTRAINT "document_sequences_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- =====================================================================
-- 2) New columns, nullable for now - backfilled below, tightened at the
-- end of this same transactional migration.
-- =====================================================================

ALTER TABLE "distributor_purchase_orders" ADD COLUMN "financial_year_id" TEXT;
ALTER TABLE "distributor_purchase_orders" ADD COLUMN "po_serial" INTEGER;

ALTER TABLE "job_orders" ADD COLUMN "financial_year_id" TEXT;
ALTER TABLE "job_orders" ADD COLUMN "job_order_serial" INTEGER;

ALTER TABLE "seasons" ADD COLUMN "financial_year_id" TEXT;

-- =====================================================================
-- 3) Backfill FinancialYear rows
-- =====================================================================

-- Purchase Orders: FY of each existing po_date.
INSERT INTO "financial_years" ("id", "code", "start_date", "end_date", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  fy_start_year || '-' || LPAD(((fy_start_year + 1) % 100)::text, 2, '0'),
  MAKE_DATE(fy_start_year, 4, 1),
  MAKE_DATE(fy_start_year + 1, 4, 1) - 1,
  now(), now()
FROM (
  SELECT DISTINCT
    (EXTRACT(YEAR FROM "po_date")::int
      - CASE WHEN EXTRACT(MONTH FROM "po_date") < 4 THEN 1 ELSE 0 END) AS fy_start_year
  FROM "distributor_purchase_orders"
) AS po_years
ON CONFLICT ("code") DO NOTHING;

-- Job Orders: FY of each existing created_at, converted to the Asia/Kolkata
-- business calendar date first - consistent with BUSINESS_TIMEZONE in
-- financial-year.util.ts, so a JO created just after midnight IST resolves
-- the same way the application's own resolver would.
INSERT INTO "financial_years" ("id", "code", "start_date", "end_date", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  fy_start_year || '-' || LPAD(((fy_start_year + 1) % 100)::text, 2, '0'),
  MAKE_DATE(fy_start_year, 4, 1),
  MAKE_DATE(fy_start_year + 1, 4, 1) - 1,
  now(), now()
FROM (
  SELECT DISTINCT
    (EXTRACT(YEAR FROM business_date)::int
      - CASE WHEN EXTRACT(MONTH FROM business_date) < 4 THEN 1 ELSE 0 END) AS fy_start_year
  FROM (
    SELECT ("created_at" AT TIME ZONE 'Asia/Kolkata')::date AS business_date
    FROM "job_orders"
  ) AS jo_dates
) AS jo_years
ON CONFLICT ("code") DO NOTHING;

-- Seasons: parsed from their existing free-text financial_year ("26-27").
-- Never guessed - any row whose text isn't exactly two consecutive
-- two-digit years fails this migration loudly instead of silently mapping
-- it to something invented.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM "seasons"
  WHERE "financial_year" !~ '^[0-9]{2}-[0-9]{2}$'
     OR (substring("financial_year" from 1 for 2)::int + 1) % 100
        <> substring("financial_year" from 4 for 2)::int;
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'financial_year_documents migration: % Season row(s) have a financial_year value that is not two consecutive two-digit years - fix or remove them before migrating',
      bad_count;
  END IF;
END $$;

INSERT INTO "financial_years" ("id", "code", "start_date", "end_date", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  full_code,
  MAKE_DATE(start_year, 4, 1),
  MAKE_DATE(start_year + 1, 4, 1) - 1,
  now(), now()
FROM (
  SELECT DISTINCT
    (2000 + substring("financial_year" from 1 for 2)::int) AS start_year,
    ('20' || "financial_year") AS full_code
  FROM "seasons"
) AS season_years
ON CONFLICT ("code") DO NOTHING;

-- =====================================================================
-- 4) Backfill financial_year_id on each table
-- =====================================================================

UPDATE "distributor_purchase_orders" po
SET "financial_year_id" = fy."id"
FROM "financial_years" fy,
     (SELECT "id" AS po_id,
             (EXTRACT(YEAR FROM "po_date")::int
               - CASE WHEN EXTRACT(MONTH FROM "po_date") < 4 THEN 1 ELSE 0 END) AS fy_start_year
      FROM "distributor_purchase_orders") computed
WHERE po."id" = computed.po_id
  AND fy."code" = computed.fy_start_year || '-' || LPAD(((computed.fy_start_year + 1) % 100)::text, 2, '0');

UPDATE "job_orders" jo
SET "financial_year_id" = fy."id"
FROM "financial_years" fy,
     (SELECT "id" AS jo_id,
             (EXTRACT(YEAR FROM (("created_at" AT TIME ZONE 'Asia/Kolkata')::date))::int
               - CASE WHEN EXTRACT(MONTH FROM (("created_at" AT TIME ZONE 'Asia/Kolkata')::date)) < 4 THEN 1 ELSE 0 END) AS fy_start_year
      FROM "job_orders") computed
WHERE jo."id" = computed.jo_id
  AND fy."code" = computed.fy_start_year || '-' || LPAD(((computed.fy_start_year + 1) % 100)::text, 2, '0');

UPDATE "seasons" s
SET "financial_year_id" = fy."id"
FROM "financial_years" fy
WHERE fy."code" = '20' || s."financial_year";

-- =====================================================================
-- 5) Internal bookkeeping serials - deterministic, not a reconstruction of
-- the legacy calendar-year-scoped suffix already embedded in
-- po_number/job_order_number (which are never touched by this migration).
-- =====================================================================

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "financial_year_id" ORDER BY "po_date", "created_at", "id") AS rn
  FROM "distributor_purchase_orders"
)
UPDATE "distributor_purchase_orders" po
SET "po_serial" = ranked.rn
FROM ranked
WHERE po."id" = ranked."id";

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "financial_year_id" ORDER BY "created_at", "id") AS rn
  FROM "job_orders"
)
UPDATE "job_orders" jo
SET "job_order_serial" = ranked.rn
FROM ranked
WHERE jo."id" = ranked."id";

-- Seed each Financial Year's DocumentSequence high-water mark at the max
-- backfilled serial, so the first newly-created document in an FY that
-- already has historical documents continues the *new* numbering scheme's
-- own count rather than starting over at 0.
INSERT INTO "document_sequences" ("id", "document_type", "financial_year_id", "last_allocated_serial", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'PURCHASE_ORDER', "financial_year_id", MAX("po_serial"), now(), now()
FROM "distributor_purchase_orders"
GROUP BY "financial_year_id"
ON CONFLICT ("document_type", "financial_year_id") DO NOTHING;

INSERT INTO "document_sequences" ("id", "document_type", "financial_year_id", "last_allocated_serial", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'JOB_ORDER', "financial_year_id", MAX("job_order_serial"), now(), now()
FROM "job_orders"
GROUP BY "financial_year_id"
ON CONFLICT ("document_type", "financial_year_id") DO NOTHING;

-- =====================================================================
-- 6) Tighten: NOT NULL, FKs, uniqueness. Postgres's own constraint
-- validation is the completeness/uniqueness check - a leftover NULL or a
-- duplicate (financial_year_id, serial) pair fails one of the statements
-- below and rolls back this entire transactional migration.
-- =====================================================================

ALTER TABLE "distributor_purchase_orders" ALTER COLUMN "financial_year_id" SET NOT NULL;
ALTER TABLE "distributor_purchase_orders" ALTER COLUMN "po_serial" SET NOT NULL;
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_financial_year_id_fkey"
  FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "distributor_purchase_orders" ADD CONSTRAINT "distributor_purchase_orders_financial_year_id_po_serial_key"
  UNIQUE ("financial_year_id", "po_serial");

ALTER TABLE "job_orders" ALTER COLUMN "financial_year_id" SET NOT NULL;
ALTER TABLE "job_orders" ALTER COLUMN "job_order_serial" SET NOT NULL;
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_financial_year_id_fkey"
  FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_financial_year_id_job_order_serial_key"
  UNIQUE ("financial_year_id", "job_order_serial");

ALTER TABLE "seasons" ALTER COLUMN "financial_year_id" SET NOT NULL;
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_financial_year_id_fkey"
  FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Season identity moves from (code, free-text financial_year) to
-- (code, financial_year_id) - same case-insensitive-code-per-FY semantics
-- as today, now FK-backed instead of text-backed.
DROP INDEX "seasons_code_financial_year_ci_key";
ALTER TABLE "seasons" DROP COLUMN "financial_year";
CREATE UNIQUE INDEX "seasons_financial_year_id_code_ci_key" ON "seasons" ("financial_year_id", LOWER("code"));
