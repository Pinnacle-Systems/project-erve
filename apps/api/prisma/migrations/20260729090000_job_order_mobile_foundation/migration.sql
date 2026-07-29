ALTER TABLE "distributor_purchase_orders"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "job_orders"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "distributor_purchase_order_line_sizes"
  ADD CONSTRAINT "po_line_size_quantities_nonnegative"
  CHECK (
    "ordered_quantity" >= 0 AND
    "job_ordered_quantity" >= 0 AND
    "job_ordered_quantity" <= "ordered_quantity"
  );

ALTER TABLE "job_order_line_sizes"
  ADD CONSTRAINT "job_order_line_size_quantities_nonnegative"
  CHECK ("ordered_quantity" >= 0 AND "prepared_quantity" >= 0);

CREATE TABLE "job_order_idempotency_records" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "job_order_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "result_version" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_order_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_order_idempotency_records_actor_id_operation_idempotency_key_key"
  ON "job_order_idempotency_records"("actor_id", "operation", "idempotency_key");
CREATE INDEX "job_order_idempotency_records_job_order_id_idx"
  ON "job_order_idempotency_records"("job_order_id");

ALTER TABLE "job_order_idempotency_records"
  ADD CONSTRAINT "job_order_idempotency_records_job_order_id_fkey"
  FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
