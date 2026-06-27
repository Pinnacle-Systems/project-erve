-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMIN', 'MERCHANDISER', 'FACTORY_USER', 'QA_USER', 'ACCOUNTANT', 'DISTRIBUTOR', 'SENIOR_MANAGEMENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FactoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "StyleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "SizeRangeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProcessFlowStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProcessFlowVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "ProcessStageStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "status" "DistributorStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "status" "FactoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_distributors" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "distributor_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_factories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "factory_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_factories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "styles" (
    "id" TEXT NOT NULL,
    "style_number" TEXT NOT NULL,
    "style_name" TEXT NOT NULL,
    "description" TEXT,
    "colour" TEXT,
    "lmix_number" TEXT,
    "licensor" TEXT,
    "ip_reference" TEXT,
    "hsn_code" TEXT,
    "hsn_description" TEXT,
    "mrp" DECIMAL(12,2) NOT NULL,
    "status" "StyleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_images" (
    "id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_ranges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sizes" TEXT[],
    "status" "SizeRangeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "size_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_size_ranges" (
    "id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "size_range_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_size_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distributor_id" TEXT,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "status" "PriceListStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_lines" (
    "id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_flows" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProcessFlowStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_flow_versions" (
    "id" TEXT NOT NULL,
    "process_flow_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "ProcessFlowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_from" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_flow_version_stages" (
    "id" TEXT NOT NULL,
    "process_flow_version_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "ProcessStageStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_flow_version_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "url" TEXT,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_mobile_key" ON "users"("mobile");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "user_roles_user_id_idx" ON "user_roles"("user_id");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributors_code_key" ON "distributors"("code");

-- CreateIndex
CREATE INDEX "distributors_status_idx" ON "distributors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "factories_code_key" ON "factories"("code");

-- CreateIndex
CREATE INDEX "factories_status_idx" ON "factories"("status");

-- CreateIndex
CREATE INDEX "user_distributors_user_id_idx" ON "user_distributors"("user_id");

-- CreateIndex
CREATE INDEX "user_distributors_distributor_id_idx" ON "user_distributors"("distributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_distributors_user_id_distributor_id_key" ON "user_distributors"("user_id", "distributor_id");

-- CreateIndex
CREATE INDEX "user_factories_user_id_idx" ON "user_factories"("user_id");

-- CreateIndex
CREATE INDEX "user_factories_factory_id_idx" ON "user_factories"("factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_factories_user_id_factory_id_key" ON "user_factories"("user_id", "factory_id");

-- CreateIndex
CREATE UNIQUE INDEX "styles_style_number_key" ON "styles"("style_number");

-- CreateIndex
CREATE INDEX "styles_status_idx" ON "styles"("status");

-- CreateIndex
CREATE INDEX "style_images_style_id_idx" ON "style_images"("style_id");

-- CreateIndex
CREATE INDEX "style_images_file_id_idx" ON "style_images"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "size_ranges_code_key" ON "size_ranges"("code");

-- CreateIndex
CREATE INDEX "size_ranges_status_idx" ON "size_ranges"("status");

-- CreateIndex
CREATE INDEX "style_size_ranges_style_id_idx" ON "style_size_ranges"("style_id");

-- CreateIndex
CREATE INDEX "style_size_ranges_size_range_id_idx" ON "style_size_ranges"("size_range_id");

-- CreateIndex
CREATE UNIQUE INDEX "style_size_ranges_style_id_size_range_id_key" ON "style_size_ranges"("style_id", "size_range_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_code_key" ON "price_lists"("code");

-- CreateIndex
CREATE INDEX "price_lists_distributor_id_idx" ON "price_lists"("distributor_id");

-- CreateIndex
CREATE INDEX "price_lists_status_idx" ON "price_lists"("status");

-- CreateIndex
CREATE INDEX "price_list_lines_price_list_id_idx" ON "price_list_lines"("price_list_id");

-- CreateIndex
CREATE INDEX "price_list_lines_style_id_idx" ON "price_list_lines"("style_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_lines_price_list_id_style_id_key" ON "price_list_lines"("price_list_id", "style_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_flows_code_key" ON "process_flows"("code");

-- CreateIndex
CREATE INDEX "process_flows_status_idx" ON "process_flows"("status");

-- CreateIndex
CREATE INDEX "process_flow_versions_process_flow_id_idx" ON "process_flow_versions"("process_flow_id");

-- CreateIndex
CREATE INDEX "process_flow_versions_status_idx" ON "process_flow_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "process_flow_versions_process_flow_id_version_number_key" ON "process_flow_versions"("process_flow_id", "version_number");

-- CreateIndex
CREATE INDEX "process_flow_version_stages_process_flow_version_id_idx" ON "process_flow_version_stages"("process_flow_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_flow_version_stages_process_flow_version_id_sequenc_key" ON "process_flow_version_stages"("process_flow_version_id", "sequence");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "files_storage_key_idx" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_uploaded_by_id_idx" ON "files"("uploaded_by_id");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_distributors" ADD CONSTRAINT "user_distributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_distributors" ADD CONSTRAINT "user_distributors_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_factories" ADD CONSTRAINT "user_factories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_factories" ADD CONSTRAINT "user_factories_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_images" ADD CONSTRAINT "style_images_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_images" ADD CONSTRAINT "style_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_size_ranges" ADD CONSTRAINT "style_size_ranges_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_size_ranges" ADD CONSTRAINT "style_size_ranges_size_range_id_fkey" FOREIGN KEY ("size_range_id") REFERENCES "size_ranges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_lines" ADD CONSTRAINT "price_list_lines_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_flow_versions" ADD CONSTRAINT "process_flow_versions_process_flow_id_fkey" FOREIGN KEY ("process_flow_id") REFERENCES "process_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_flow_version_stages" ADD CONSTRAINT "process_flow_version_stages_process_flow_version_id_fkey" FOREIGN KEY ("process_flow_version_id") REFERENCES "process_flow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
