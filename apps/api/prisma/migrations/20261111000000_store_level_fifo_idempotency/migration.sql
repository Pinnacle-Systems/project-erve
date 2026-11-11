-- ISS-089: retry-safe Store-level FIFO Sales Reports and Returns.
-- Nullable columns only: every existing (Dispatch-linked) row keeps NULL, and a unique
-- index over NULLs never conflicts, so existing data and workflows are unaffected.
ALTER TABLE "distributor_sales_reports" ADD COLUMN "idempotency_key" TEXT,
ADD COLUMN "request_digest" TEXT;

ALTER TABLE "distributor_returns" ADD COLUMN "idempotency_key" TEXT,
ADD COLUMN "request_digest" TEXT;

CREATE UNIQUE INDEX "distributor_sales_reports_distributor_id_idempotency_key_key" ON "distributor_sales_reports"("distributor_id", "idempotency_key");

CREATE UNIQUE INDEX "distributor_returns_distributor_id_idempotency_key_key" ON "distributor_returns"("distributor_id", "idempotency_key");
