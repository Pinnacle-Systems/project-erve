-- CreateTable
CREATE TABLE "gst_verification_evidence" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "requested_gstin" TEXT NOT NULL,
    "normalized_gstin" TEXT NOT NULL,
    "lookup_gstin" TEXT NOT NULL,
    "returned_gstin" TEXT NOT NULL,
    "mode" "GstIntegrationMode" NOT NULL,
    "level" "GstinVerificationLevel" NOT NULL,
    "profile" JSONB NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ttl_seconds" INTEGER NOT NULL,
    "estimated_credits" INTEGER NOT NULL,
    "actual_credits" DOUBLE PRECISION,
    "billing_category" TEXT,

    CONSTRAINT "gst_verification_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_verification_operations" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "requested_gstin" TEXT NOT NULL,
    "normalized_gstin" TEXT NOT NULL,
    "source_type" TEXT,
    "source_id" TEXT,
    "mode" "GstIntegrationMode" NOT NULL,
    "level" "GstinVerificationLevel" NOT NULL,
    "settings_version" INTEGER NOT NULL,
    "refresh" BOOLEAN NOT NULL DEFAULT false,
    "estimated_credits" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'PREPARED',
    "failure_code" TEXT,
    "provider_balance" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "gst_verification_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_verification_claims" (
    "key" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "review_after" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_verification_claims_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "gst_verification_evidence_operation_id_key" ON "gst_verification_evidence"("operation_id");

-- CreateIndex
CREATE INDEX "gst_verification_evidence_normalized_gstin_mode_level_expir_idx" ON "gst_verification_evidence"("normalized_gstin", "mode", "level", "expires_at", "retrieved_at");

-- CreateIndex
CREATE INDEX "gst_verification_operations_normalized_gstin_mode_created_a_idx" ON "gst_verification_operations"("normalized_gstin", "mode", "created_at");

-- CreateIndex
CREATE INDEX "gst_verification_operations_actor_id_created_at_idx" ON "gst_verification_operations"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "gst_verification_operations_dispatched_at_idx" ON "gst_verification_operations"("dispatched_at");

-- CreateIndex
CREATE UNIQUE INDEX "gst_verification_claims_operation_id_key" ON "gst_verification_claims"("operation_id");

-- AddForeignKey
ALTER TABLE "gst_verification_evidence" ADD CONSTRAINT "gst_verification_evidence_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "gst_verification_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_verification_claims" ADD CONSTRAINT "gst_verification_claims_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "gst_verification_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
