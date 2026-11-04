-- Track B / B2B: E-Way Bill movement arrangement, bill verification status,
-- attempt recovery columns and Live-only number uniqueness.
-- Purely additive except for replacing one unique index (see below). No
-- existing invoice, packing-list or dispatch table is touched, and no data is
-- backfilled beyond classifying the (empty in practice) existing eway_bills
-- rows by their integration mode.

-- AlterEnum
-- A DEMO attempt an Accountant explicitly closed. The value is not referenced
-- anywhere else in this migration (a new enum value is unusable inside the
-- transaction that adds it).
ALTER TYPE "EwayBillAttemptOutcome" ADD VALUE 'CLOSED';

-- CreateEnum
CREATE TYPE "EwayBillVerificationStatus" AS ENUM ('SYNTHETIC_DEMO', 'UNVERIFIED_REFERENCE', 'PROVIDER_VERIFIED');

-- CreateEnum
CREATE TYPE "EwayBillShipToArrangement" AS ENUM ('BILLED_PARTY', 'DIFFERENT_PARTY');

-- CreateEnum
CREATE TYPE "EwayBillDispatchFromArrangement" AS ENUM ('SUPPLIER_REGISTERED_PREMISES', 'DIFFERENT_PLACE');

-- AlterTable: movement arrangement (both nullable: partial capture is valid)
ALTER TABLE "eway_bill_movements"
  ADD COLUMN "ship_to_arrangement" "EwayBillShipToArrangement",
  ADD COLUMN "dispatch_from_arrangement" "EwayBillDispatchFromArrangement";

-- AlterTable: bill verification status. The default is the weakest status, so
-- a row written without an explicit value can never read as verified.
ALTER TABLE "eway_bills"
  ADD COLUMN "verification_status" "EwayBillVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED_REFERENCE',
  ADD COLUMN "verified_at" TIMESTAMP(3);

-- Any DEMO row that already exists is synthetic by definition.
UPDATE "eway_bills" SET "verification_status" = 'SYNTHETIC_DEMO' WHERE "integration_mode" = 'DEMO';

-- AlterTable: attempt recovery columns
ALTER TABLE "eway_bill_request_attempts"
  ADD COLUMN "movement_version" INTEGER,
  ADD COLUMN "resolved_by_id" TEXT,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolution_reason" TEXT;

-- AddForeignKey
ALTER TABLE "eway_bill_request_attempts" ADD CONSTRAINT "eway_bill_request_attempts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints Prisma cannot express (precedent: B1's partial
-- unique indexes, quality_form_versions_one_published).

-- B1 made (integration_mode, eway_bill_number) globally unique. GSTINAPI's
-- synthetic Demo numbers may repeat across invoices, so that would let one
-- invoice's Demo bill block another's. Only a LIVE (statutory) number must be
-- unique. DROP INDEX is safe: the replacement below is strictly narrower in
-- what it enforces for DEMO and equivalent for LIVE.
DROP INDEX "eway_bills_integration_mode_eway_bill_number_key";

CREATE UNIQUE INDEX "eway_bills_live_number_key"
  ON "eway_bills"("eway_bill_number")
  WHERE "integration_mode" = 'LIVE';

-- A DEMO bill is always synthetic; a LIVE bill is never synthetic.
ALTER TABLE "eway_bills"
  ADD CONSTRAINT "eway_bills_verification_matches_mode"
  CHECK (
    ("integration_mode" = 'DEMO' AND "verification_status" = 'SYNTHETIC_DEMO')
    OR ("integration_mode" = 'LIVE' AND "verification_status" <> 'SYNTHETIC_DEMO')
  );

-- verified_at is set if and only if a provider verified the bill.
ALTER TABLE "eway_bills"
  ADD CONSTRAINT "eway_bills_verified_at_matches_status"
  CHECK (("verification_status" = 'PROVIDER_VERIFIED') = ("verified_at" IS NOT NULL));

-- Manual resolution is all-or-nothing: actor, time and reason together.
ALTER TABLE "eway_bill_request_attempts"
  ADD CONSTRAINT "eway_bill_request_attempts_resolution_complete"
  CHECK (
    ("resolved_by_id" IS NULL AND "resolved_at" IS NULL AND "resolution_reason" IS NULL)
    OR ("resolved_by_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_reason" IS NOT NULL)
  );
