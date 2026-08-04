ALTER TABLE "job_orders"
  ADD COLUMN "disclaimer_text" TEXT,
  ADD COLUMN "disclaimer_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "job_order_acknowledgements" (
  "id" TEXT NOT NULL,
  "job_order_id" TEXT NOT NULL,
  "job_order_version" INTEGER NOT NULL,
  "disclaimer_revision" INTEGER NOT NULL,
  "disclaimer_text_snapshot" TEXT NOT NULL,
  "disclaimer_sha256" TEXT NOT NULL,
  "factory_id_snapshot" TEXT NOT NULL,
  "acknowledged_by_user_id" TEXT NOT NULL,
  "acknowledged_by_role" "RoleName" NOT NULL,
  "acknowledged_at" TIMESTAMP(3) NOT NULL,
  "invalidated_at" TIMESTAMP(3),
  "invalidated_by_user_id" TEXT,
  "invalidation_reason" TEXT,
  "invalidation_metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_order_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_order_acknowledgements_job_order_id_job_order_version_key"
  ON "job_order_acknowledgements"("job_order_id", "job_order_version");
CREATE INDEX "job_order_acknowledgements_job_order_id_acknowledged_at_idx"
  ON "job_order_acknowledgements"("job_order_id", "acknowledged_at");
CREATE INDEX "job_order_acknowledgements_acknowledged_by_user_id_idx"
  ON "job_order_acknowledgements"("acknowledged_by_user_id");

ALTER TABLE "job_order_acknowledgements"
  ADD CONSTRAINT "job_order_acknowledgements_job_order_id_fkey"
  FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_order_acknowledgements"
  ADD CONSTRAINT "job_order_acknowledgements_acknowledged_by_user_id_fkey"
  FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
