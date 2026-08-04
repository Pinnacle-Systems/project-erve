ALTER TABLE "job_orders"
  ALTER COLUMN "unit_price" SET NOT NULL;

ALTER TABLE "job_orders"
  ADD CONSTRAINT "job_orders_unit_price_positive"
  CHECK ("unit_price" > 0);
