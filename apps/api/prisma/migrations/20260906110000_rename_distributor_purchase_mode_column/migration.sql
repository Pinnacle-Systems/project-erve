-- Naming-convention fix: every other column on this table (and the
-- equivalent purchaseMode column on distributor_purchase_orders) uses
-- snake_case via an explicit @map — Distributor.purchaseMode was added
-- without one in the prior migration. Renaming to match, consistent with
-- the rest of the schema.
ALTER TABLE "distributors" RENAME COLUMN "purchaseMode" TO "purchase_mode";
