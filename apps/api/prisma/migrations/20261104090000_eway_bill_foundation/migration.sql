-- CreateEnum
CREATE TYPE "EwayBillSource" AS ENUM ('PROVIDER_GENERATED', 'EXTERNALLY_LINKED');

-- CreateEnum
CREATE TYPE "EwayBillStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EwayBillTransportMode" AS ENUM ('ROAD', 'RAIL', 'AIR', 'SHIP');

-- CreateEnum
CREATE TYPE "EwayBillVehicleType" AS ENUM ('REGULAR', 'OVER_DIMENSIONAL');

-- CreateEnum
CREATE TYPE "EwayBillAttemptOutcome" AS ENUM ('PREPARED', 'DISPATCHED', 'SUCCEEDED', 'REJECTED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "eway_bills" (
    "id" TEXT NOT NULL,
    "tax_invoice_id" TEXT NOT NULL,
    "source" "EwayBillSource" NOT NULL,
    "status" "EwayBillStatus" NOT NULL DEFAULT 'ACTIVE',
    "integration_mode" "GstIntegrationMode" NOT NULL,
    "eway_bill_number" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "provider_name" TEXT,
    "provider_reference" TEXT,
    "request_attempt_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_id" TEXT,
    "cancellation_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "eway_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eway_bill_movements" (
    "id" TEXT NOT NULL,
    "tax_invoice_id" TEXT NOT NULL,
    "transport_mode" "EwayBillTransportMode",
    "vehicle_number" TEXT,
    "vehicle_type" "EwayBillVehicleType",
    "transporter_id" TEXT,
    "transporter_name" TEXT,
    "transport_document_number" TEXT,
    "transport_document_date" DATE,
    "approximate_distance_km" INTEGER,
    "dispatch_from_address_line1" TEXT,
    "dispatch_from_address_line2" TEXT,
    "dispatch_from_city" TEXT,
    "dispatch_from_state" TEXT,
    "dispatch_from_state_code" TEXT,
    "dispatch_from_postal_code" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "eway_bill_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eway_bill_request_attempts" (
    "id" TEXT NOT NULL,
    "tax_invoice_id" TEXT NOT NULL,
    "integration_mode" "GstIntegrationMode" NOT NULL,
    "actor_id" TEXT NOT NULL,
    "outcome" "EwayBillAttemptOutcome" NOT NULL DEFAULT 'PREPARED',
    "document_type" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "document_date" DATE NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "provider_reference" TEXT,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "review_after" TIMESTAMP(3),

    CONSTRAINT "eway_bill_request_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eway_bills_request_attempt_id_key" ON "eway_bills"("request_attempt_id");

-- CreateIndex
CREATE INDEX "eway_bills_tax_invoice_id_integration_mode_idx" ON "eway_bills"("tax_invoice_id", "integration_mode");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bills_integration_mode_eway_bill_number_key" ON "eway_bills"("integration_mode", "eway_bill_number");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bill_movements_tax_invoice_id_key" ON "eway_bill_movements"("tax_invoice_id");

-- CreateIndex
CREATE INDEX "eway_bill_request_attempts_tax_invoice_id_integration_mode__idx" ON "eway_bill_request_attempts"("tax_invoice_id", "integration_mode", "created_at");

-- CreateIndex
CREATE INDEX "eway_bill_request_attempts_actor_id_created_at_idx" ON "eway_bill_request_attempts"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_tax_invoice_id_fkey" FOREIGN KEY ("tax_invoice_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_request_attempt_id_fkey" FOREIGN KEY ("request_attempt_id") REFERENCES "eway_bill_request_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_movements" ADD CONSTRAINT "eway_bill_movements_tax_invoice_id_fkey" FOREIGN KEY ("tax_invoice_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_movements" ADD CONSTRAINT "eway_bill_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_movements" ADD CONSTRAINT "eway_bill_movements_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_request_attempts" ADD CONSTRAINT "eway_bill_request_attempts_tax_invoice_id_fkey" FOREIGN KEY ("tax_invoice_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_request_attempts" ADD CONSTRAINT "eway_bill_request_attempts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written constraints Prisma cannot express (precedent:
-- quality_form_versions_one_published). All are scoped by integration_mode so
-- a DEMO (synthetic) record can never prevent a legitimate LIVE record.

-- At most one ACTIVE E-Way Bill per Tax Invoice per integration mode.
CREATE UNIQUE INDEX "eway_bills_one_active_per_invoice_mode"
  ON "eway_bills"("tax_invoice_id", "integration_mode")
  WHERE "status" = 'ACTIVE';

-- At most one open (unfinished) request attempt per Tax Invoice per
-- integration mode. UNCERTAIN stays open until reconciled.
CREATE UNIQUE INDEX "eway_bill_request_attempts_one_open_per_invoice_mode"
  ON "eway_bill_request_attempts"("tax_invoice_id", "integration_mode")
  WHERE "outcome" IN ('PREPARED', 'DISPATCHED', 'UNCERTAIN');

-- An externally generated bill is a real statutory document: never DEMO.
ALTER TABLE "eway_bills"
  ADD CONSTRAINT "eway_bills_external_is_live"
  CHECK ("source" <> 'EXTERNALLY_LINKED' OR "integration_mode" = 'LIVE');

-- A cancelled bill must record when it was cancelled.
ALTER TABLE "eway_bills"
  ADD CONSTRAINT "eway_bills_cancelled_has_timestamp"
  CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

-- Distance is kilometres; 0 is valid (NIC computes it), negative is not.
ALTER TABLE "eway_bill_movements"
  ADD CONSTRAINT "eway_bill_movements_distance_non_negative"
  CHECK ("approximate_distance_km" IS NULL OR "approximate_distance_km" >= 0);
