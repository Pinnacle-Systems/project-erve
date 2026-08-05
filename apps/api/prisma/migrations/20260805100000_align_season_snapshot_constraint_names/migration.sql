-- Align names created by the initial ERVE-016 migration with Prisma's
-- convention-derived names. Keep convention-derived foreign-key and unique
-- index names in hand-written migrations so `prisma migrate dev` does not
-- produce rename-only follow-up migrations.
ALTER TABLE "job_order_season_snapshots"
  RENAME CONSTRAINT "job_order_season_snapshots_order_fkey"
  TO "job_order_season_snapshots_job_order_id_fkey";

ALTER TABLE "purchase_order_line_season_snapshots"
  RENAME CONSTRAINT "purchase_order_line_season_snapshots_line_fkey"
  TO "purchase_order_line_season_snapshots_purchase_order_line_i_fkey";

ALTER INDEX "job_order_season_snapshots_order_season_key"
  RENAME TO "job_order_season_snapshots_job_order_id_season_id_key";

ALTER INDEX "purchase_order_line_season_snapshots_line_season_key"
  RENAME TO "purchase_order_line_season_snapshots_purchase_order_line_id_key";
