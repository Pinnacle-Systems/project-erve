-- Existing Job Orders have no authoritative historical factory-price source.
-- Keep this column nullable at the database boundary for safe deployment of
-- legacy data; all application create paths require a positive value.
ALTER TABLE "job_orders" ADD COLUMN "unit_price" DECIMAL(12,2);
