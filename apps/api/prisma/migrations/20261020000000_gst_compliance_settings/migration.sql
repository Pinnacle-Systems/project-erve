-- Phase 1A only. Do not apply without deployment approval.
CREATE TYPE "GstIntegrationMode" AS ENUM ('DEMO', 'LIVE');
CREATE TYPE "GstinVerificationLevel" AS ENUM ('BASIC', 'COMPLETE');

CREATE TABLE "gst_compliance_settings" (
  "scope" TEXT NOT NULL DEFAULT 'APPLICATION',
  "integration_mode" "GstIntegrationMode" NOT NULL DEFAULT 'DEMO',
  "online_gstin_verification_enabled" BOOLEAN NOT NULL DEFAULT false,
  "gstin_verification_level" "GstinVerificationLevel" NOT NULL DEFAULT 'BASIC',
  "eway_bill_generation_enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  CONSTRAINT "gst_compliance_settings_pkey" PRIMARY KEY ("scope"),
  CONSTRAINT "gst_compliance_settings_application_scope" CHECK ("scope" = 'APPLICATION'),
  CONSTRAINT "gst_compliance_settings_positive_version" CHECK ("version" > 0),
  CONSTRAINT "gst_compliance_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
