-- Historical transport strings remain independent; no account backfill.
ALTER TABLE "erve_dispatches" ADD COLUMN "transporter_user_id" TEXT;
CREATE INDEX "erve_dispatches_transporter_user_id_idx" ON "erve_dispatches"("transporter_user_id");
ALTER TABLE "erve_dispatches" ADD CONSTRAINT "erve_dispatches_transporter_user_id_fkey"
  FOREIGN KEY ("transporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
