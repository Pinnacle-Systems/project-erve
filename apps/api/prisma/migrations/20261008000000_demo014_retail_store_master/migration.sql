CREATE TABLE "retail_stores" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "distributor_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address_line1" TEXT NOT NULL,
  "address_line2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "country" TEXT NOT NULL DEFAULT 'India',
  "postal_code" TEXT NOT NULL,
  "gstin" TEXT,
  "contact_name" TEXT,
  "contact_email" TEXT,
  "contact_phone" TEXT,
  "status" "DistributorStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "retail_stores_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "retail_stores_distributor_id_code_key" ON "retail_stores"("distributor_id", "code");
CREATE INDEX "retail_stores_distributor_id_status_idx" ON "retail_stores"("distributor_id", "status");

ALTER TABLE "sale_order_destinations" ADD COLUMN "retail_store_id" TEXT, ADD COLUMN "store_code" TEXT;
ALTER TABLE "sale_order_destinations" ADD CONSTRAINT "sale_order_destinations_retail_store_id_fkey" FOREIGN KEY ("retail_store_id") REFERENCES "retail_stores"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "sale_order_destinations_retail_store_id_idx" ON "sale_order_destinations"("retail_store_id");

-- Ownership is a creation fact, including for writes outside the API.
CREATE FUNCTION enforce_retail_store_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.distributor_id IS DISTINCT FROM OLD.distributor_id THEN
    RAISE EXCEPTION 'Retail Store Distributor cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retail_store_owner_immutable BEFORE UPDATE OF distributor_id ON retail_stores
FOR EACH ROW EXECUTE FUNCTION enforce_retail_store_owner();

-- Legacy rows stay NULL; no historical matching or rewriting.
CREATE FUNCTION enforce_destination_store_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.retail_store_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_stores s JOIN sale_order_distributors g ON g.distributor_id = s.distributor_id
    WHERE s.id = NEW.retail_store_id AND g.id = NEW.sale_order_distributor_id AND g.sale_order_id = NEW.sale_order_id
  ) THEN
    RAISE EXCEPTION 'Retail Store does not belong to destination Distributor' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER destination_store_owner BEFORE INSERT OR UPDATE OF retail_store_id, sale_order_distributor_id, sale_order_id ON sale_order_destinations
FOR EACH ROW EXECUTE FUNCTION enforce_destination_store_owner();
