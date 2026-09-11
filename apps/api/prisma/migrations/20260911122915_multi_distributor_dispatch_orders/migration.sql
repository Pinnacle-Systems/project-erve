-- Correction 8: Multi-Distributor Dispatch Orders.
--
-- A Dispatch Order (sale_orders) previously belonged to exactly one
-- Distributor (sale_orders.distributor_id). It may now belong to multiple
-- Distributors, each grouping one or more destinations. This migration
-- introduces sale_order_distributors as the new grouping entity, backfills
-- exactly one row per existing sale_order (preserving its distributor_id and
-- that Distributor's current purchase_mode — safe because
-- distributors.purchase_mode is immutable after creation, so "current" and
-- "as of any past sale_order" are always identical), re-points every
-- existing destination at its new group, then drops the old root scalar.
-- Lossless expand -> backfill -> contract shape; safe to run against an
-- empty table (the backfill/assertion steps are then no-ops) or a populated
-- one.

-- =============================================================================
-- 1. CreateTable sale_order_distributors
-- =============================================================================

CREATE TABLE "sale_order_distributors" (
    "id" TEXT NOT NULL,
    "sale_order_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "purchase_mode" "PurchaseMode" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_order_distributors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sale_order_distributors_distributor_id_idx" ON "sale_order_distributors"("distributor_id");

-- Composite unique purely so sale_order_destinations can hold a composite FK
-- into this table (see step 5) — id alone remains the primary key.
CREATE UNIQUE INDEX "sale_order_distributors_id_sale_order_id_key" ON "sale_order_distributors"("id", "sale_order_id");

CREATE UNIQUE INDEX "sale_order_distributors_sale_order_id_distributor_id_key" ON "sale_order_distributors"("sale_order_id", "distributor_id");

ALTER TABLE "sale_order_distributors" ADD CONSTRAINT "sale_order_distributors_sale_order_id_fkey" FOREIGN KEY ("sale_order_id") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "sale_order_distributors" ADD CONSTRAINT "sale_order_distributors_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- =============================================================================
-- 2. Expand: add the new destination columns, nullable for now
-- =============================================================================

ALTER TABLE "sale_order_destinations" ADD COLUMN "sale_order_distributor_id" TEXT;
ALTER TABLE "sale_order_destinations" ADD COLUMN "gstin" TEXT;

-- =============================================================================
-- 3. Backfill: one sale_order_distributors row per existing sale_order.
--    Ids are explicitly generated as gen_random_uuid()::text — raw SQL
--    migrations have no access to the application's createId()/ULID
--    generator, matching this repo's own precedent for exactly this
--    situation (see 20260903115623_backfill_outright_invoice_handoffs,
--    which backfills invoice_handoffs.id the same way). No code depends on
--    id format/prefix, so the resulting mismatch with future
--    application-generated ULID ids on this table is cosmetic only.
-- =============================================================================

INSERT INTO "sale_order_distributors" ("id", "sale_order_id", "distributor_id", "purchase_mode", "created_at", "updated_at")
SELECT gen_random_uuid()::text, so."id", so."distributor_id", d."purchase_mode", so."created_at", now()
FROM "sale_orders" so
JOIN "distributors" d ON d."id" = so."distributor_id";

-- =============================================================================
-- 4. Point every existing destination at its sale_order's new (sole) group.
-- =============================================================================

UPDATE "sale_order_destinations" AS sod
SET "sale_order_distributor_id" = sd."id"
FROM "sale_order_distributors" AS sd
WHERE sd."sale_order_id" = sod."sale_order_id";

-- =============================================================================
-- 5. Contract: assert the backfill is complete, then enforce NOT NULL + the
--    composite FK + index. The assertion fails the migration/deployment
--    outright with a clear message rather than relying only on a manual
--    pre-check.
-- =============================================================================

DO $$
DECLARE unmatched_count integer;
BEGIN
  SELECT count(*) INTO unmatched_count FROM "sale_order_destinations" WHERE "sale_order_distributor_id" IS NULL;
  IF unmatched_count > 0 THEN
    RAISE EXCEPTION 'multi_distributor_dispatch_orders backfill left % sale_order_destinations unlinked', unmatched_count;
  END IF;
END $$;

ALTER TABLE "sale_order_destinations" ALTER COLUMN "sale_order_distributor_id" SET NOT NULL;

CREATE INDEX "sale_order_destinations_sale_order_distributor_id_idx" ON "sale_order_destinations"("sale_order_distributor_id");

-- Single integrity constraint for destination <-> group <-> order
-- consistency: proves both that the group exists and that it belongs to the
-- same sale_order as the destination. No separate plain FK on
-- sale_order_distributor_id alone — this composite FK already subsumes it.
ALTER TABLE "sale_order_destinations" ADD CONSTRAINT "sale_order_destinations_sale_order_distributor_id_sale_ord_fkey" FOREIGN KEY ("sale_order_distributor_id", "sale_order_id") REFERENCES "sale_order_distributors"("id", "sale_order_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- =============================================================================
-- 6. Drop the old root scalar — no phased deprecation, matching this repo's
--    convention and avoiding two writable Distributor sources of truth.
-- =============================================================================

ALTER TABLE "sale_orders" DROP CONSTRAINT "sale_orders_distributor_id_fkey";

DROP INDEX "sale_orders_distributor_id_idx";

ALTER TABLE "sale_orders" DROP COLUMN "distributor_id";
