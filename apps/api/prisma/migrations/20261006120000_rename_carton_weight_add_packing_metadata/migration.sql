-- DEMO-018: Carton Net Weight / Gross Weight / Dimensions
--
-- Additive, no data loss:
--   1. Rename the existing `weight` column to `net_weight` (column rename
--      only — no type change, no backfill). This preserves the already-
--      shipped numeric Decimal(10,3) semantics and every existing value.
--   2. Add nullable `gross_weight` Decimal(10,3), same convention as
--      net_weight.
--   3. Add nullable `dimensions` free-text column.
--
-- None of the three are required to create/edit a carton — they are only
-- enforced (non-null, non-blank) at Factory Packing List finalization time,
-- application-side (see finalizeFactoryDispatch in factory-dispatch.service.ts).

ALTER TABLE "factory_packing_cartons" RENAME COLUMN "weight" TO "net_weight";

ALTER TABLE "factory_packing_cartons" ADD COLUMN "gross_weight" DECIMAL(10,3);

ALTER TABLE "factory_packing_cartons" ADD COLUMN "dimensions" TEXT;
