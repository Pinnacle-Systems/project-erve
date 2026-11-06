-- A4 (ISS-079/080): Distributor actual-receipt evidence. Additive only; no
-- backfill and no rewriting of any historical ledger or header row.
CREATE TYPE "DistributorReceiptLedgerDisposition" AS ENUM ('APPLIED', 'NOT_APPLIED_ZERO', 'EVIDENCE_ONLY_EXISTING');

CREATE TABLE "erve_dispatch_distributor_receipts" (
  "id" TEXT PRIMARY KEY,
  "erve_dispatch_id" TEXT NOT NULL REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "distributor_id" TEXT NOT NULL REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "received_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remarks" TEXT CHECK (length("remarks") <= 1000),
  "total_dispatched_quantity" INTEGER NOT NULL CHECK ("total_dispatched_quantity" > 0),
  "total_received_quantity" INTEGER NOT NULL CHECK ("total_received_quantity" >= 0 AND "total_received_quantity" <= "total_dispatched_quantity"),
  "ledger_disposition" "DistributorReceiptLedgerDisposition" NOT NULL,
  "prior_status" "ErveDispatchStatus" NOT NULL,
  "prior_delivery_confirmation_source" "DeliveryConfirmationSource",
  "prior_delivered_by_id" TEXT,
  "prior_delivered_at" TIMESTAMP(3),
  "prior_delivery_remarks" TEXT,
  "idempotency_key" TEXT NOT NULL CHECK (length("idempotency_key") BETWEEN 1 AND 200),
  "payload_digest" TEXT NOT NULL,
  -- A shortage (including all-zero) always carries remarks.
  CHECK ("total_received_quantity" = "total_dispatched_quantity" OR length(trim(coalesce("remarks", ''))) > 0),
  CHECK ("ledger_disposition" <> 'APPLIED' OR "total_received_quantity" > 0),
  CHECK ("ledger_disposition" <> 'NOT_APPLIED_ZERO' OR "total_received_quantity" = 0)
);
CREATE UNIQUE INDEX "erve_dispatch_distributor_receipts_erve_dispatch_id_key"
  ON "erve_dispatch_distributor_receipts"("erve_dispatch_id");

CREATE TABLE "erve_dispatch_distributor_receipt_lines" (
  "id" TEXT PRIMARY KEY,
  "receipt_id" TEXT NOT NULL REFERENCES "erve_dispatch_distributor_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sale_order_line_id" TEXT NOT NULL REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dispatched_quantity" INTEGER NOT NULL CHECK ("dispatched_quantity" > 0),
  "received_quantity" INTEGER NOT NULL CHECK ("received_quantity" >= 0 AND "received_quantity" <= "dispatched_quantity"),
  "previous_ledger_quantity" INTEGER CHECK ("previous_ledger_quantity" >= 0)
);
CREATE UNIQUE INDEX "erve_dispatch_distributor_receipt_lines_receipt_id_sale_ord_key"
  ON "erve_dispatch_distributor_receipt_lines"("receipt_id", "sale_order_line_id");
CREATE INDEX "erve_dispatch_distributor_receipt_lines_sale_order_line_id_idx"
  ON "erve_dispatch_distributor_receipt_lines"("sale_order_line_id");

-- Final attestation is append-only, including through direct application SQL.
CREATE FUNCTION "reject_distributor_receipt_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Distributor receipt evidence is immutable';
END;
$$;
CREATE TRIGGER "distributor_receipt_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "erve_dispatch_distributor_receipts"
  FOR EACH ROW EXECUTE FUNCTION "reject_distributor_receipt_evidence_mutation"();
CREATE TRIGGER "distributor_receipt_line_evidence_immutable"
  BEFORE UPDATE OR DELETE ON "erve_dispatch_distributor_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_distributor_receipt_evidence_mutation"();
