-- Additive destination facts for new Erve Packing Lists. Historical snapshots
-- remain NULL; no live Store lookup or historical matching is performed.
ALTER TABLE "erve_packing_lists"
  ADD COLUMN "destination_store_code" TEXT,
  ADD COLUMN "destination_gstin" TEXT;
