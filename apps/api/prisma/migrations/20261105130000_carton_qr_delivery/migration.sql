CREATE TABLE "carton_delivery_tokens" (
  "id" TEXT PRIMARY KEY,
  "carton_id" TEXT REFERENCES "factory_packing_cartons"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "token_digest" TEXT NOT NULL UNIQUE,
  "encrypted_token" TEXT NOT NULL,
  "key_version" TEXT NOT NULL,
  "label_reference" TEXT NOT NULL UNIQUE,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_by_id" TEXT NOT NULL,
  "valid_for_days" INTEGER NOT NULL CHECK ("valid_for_days" BETWEEN 1 AND 3650),
  "extended_until" TIMESTAMP(3),
  "extended_at" TIMESTAMP(3),
  "extended_by_id" TEXT,
  "extension_reason" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_id" TEXT,
  "revocation_reason" TEXT,
  CHECK (("extended_until" IS NULL AND "extended_at" IS NULL AND "extended_by_id" IS NULL AND "extension_reason" IS NULL)
      OR ("extended_until" IS NOT NULL AND "extended_at" IS NOT NULL AND "extended_by_id" IS NOT NULL AND length(trim("extension_reason")) > 0)),
  CHECK (("revoked_at" IS NULL AND "revoked_by_id" IS NULL AND "revocation_reason" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL AND length(trim("revocation_reason")) > 0))
);
CREATE INDEX "carton_delivery_tokens_carton_id_idx" ON "carton_delivery_tokens"("carton_id");
CREATE UNIQUE INDEX "carton_delivery_tokens_current_carton_key" ON "carton_delivery_tokens"("carton_id")
  WHERE "revoked_at" IS NULL AND "carton_id" IS NOT NULL;

CREATE TABLE "carton_delivery_confirmations" (
  "id" TEXT PRIMARY KEY,
  "carton_id" TEXT NOT NULL UNIQUE REFERENCES "factory_packing_cartons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dispatch_id" TEXT NOT NULL REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "token_id" TEXT NOT NULL REFERENCES "carton_delivery_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "recipient_name" TEXT NOT NULL CHECK (length(trim("recipient_name")) BETWEEN 1 AND 120),
  "delivered_at" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "offset_minutes" INTEGER NOT NULL CHECK ("offset_minutes" BETWEEN -840 AND 840),
  "remarks" TEXT CHECK (length("remarks") <= 2000),
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotency_key" TEXT NOT NULL,
  "payload_digest" TEXT NOT NULL,
  CONSTRAINT "carton_delivery_confirmations_token_id_idempotency_key_key" UNIQUE ("token_id", "idempotency_key")
);
CREATE INDEX "carton_delivery_confirmations_dispatch_id_id_idx" ON "carton_delivery_confirmations"("dispatch_id", "id");

CREATE TABLE "carton_delivery_rate_buckets" (
  "key" TEXT PRIMARY KEY,
  "window_start" TIMESTAMP(3) NOT NULL,
  "requests" INTEGER NOT NULL CHECK ("requests" > 0)
);
CREATE INDEX "carton_delivery_rate_buckets_window_start_idx" ON "carton_delivery_rate_buckets"("window_start");

-- Evidence is append-only, including through direct application SQL. No backfill.
CREATE FUNCTION "reject_carton_delivery_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Carton delivery evidence is immutable';
END;
$$;
CREATE TRIGGER "carton_delivery_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "carton_delivery_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "reject_carton_delivery_evidence_mutation"();
