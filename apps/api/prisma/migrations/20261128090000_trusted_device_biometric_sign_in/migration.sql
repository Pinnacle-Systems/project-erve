-- CreateEnum
CREATE TYPE "RefreshSessionAuthMethod" AS ENUM ('PASSWORD', 'TRUSTED_DEVICE');

-- CreateEnum
CREATE TYPE "TrustedDeviceChallengePurpose" AS ENUM ('REGISTRATION', 'SIGN_IN');

-- AlterTable
ALTER TABLE "refresh_sessions" ADD COLUMN     "auth_method" "RefreshSessionAuthMethod" NOT NULL DEFAULT 'PASSWORD',
ADD COLUMN     "trusted_device_id" TEXT;

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "label" TEXT NOT NULL,
    "app_version" TEXT,
    "public_key" TEXT NOT NULL,
    "public_key_fingerprint" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_device_challenges" (
    "id" TEXT NOT NULL,
    "purpose" "TrustedDeviceChallengePurpose" NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_device_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL,

    CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_public_key_fingerprint_key" ON "trusted_devices"("public_key_fingerprint");

-- CreateIndex
CREATE INDEX "trusted_devices_user_id_revoked_at_idx" ON "trusted_devices"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "trusted_devices_expires_at_idx" ON "trusted_devices"("expires_at");

-- CreateIndex
CREATE INDEX "trusted_device_challenges_expires_at_idx" ON "trusted_device_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "trusted_device_challenges_device_id_idx" ON "trusted_device_challenges"("device_id");

-- CreateIndex
CREATE INDEX "trusted_device_challenges_user_id_idx" ON "trusted_device_challenges"("user_id");

-- CreateIndex
CREATE INDEX "refresh_sessions_trusted_device_id_idx" ON "refresh_sessions"("trusted_device_id");

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_trusted_device_id_fkey" FOREIGN KEY ("trusted_device_id") REFERENCES "trusted_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_device_challenges" ADD CONSTRAINT "trusted_device_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_device_challenges" ADD CONSTRAINT "trusted_device_challenges_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "trusted_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
