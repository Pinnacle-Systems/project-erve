-- CreateEnum
CREATE TYPE "SellerRegistrationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "seller_registrations" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "branch_code" TEXT NOT NULL,
    "status" "SellerRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "gstin" TEXT NOT NULL,
    "einvoice_applicable" BOOLEAN NOT NULL DEFAULT false,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'India',
    "bank_name" TEXT NOT NULL,
    "bank_account_name" TEXT NOT NULL,
    "bank_account_number" TEXT NOT NULL,
    "bank_ifsc" TEXT NOT NULL,
    "bank_branch_name" TEXT NOT NULL,
    "bank_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_registrations_branch_code_key" ON "seller_registrations"("branch_code");

-- CreateIndex
CREATE UNIQUE INDEX "seller_registrations_gstin_key" ON "seller_registrations"("gstin");

-- CreateIndex
CREATE INDEX "seller_registrations_status_idx" ON "seller_registrations"("status");
