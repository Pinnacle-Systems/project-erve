-- ERVE-016: no backfill is intentionally performed. Existing pre-production
-- records remain unassigned rather than receiving fabricated season data.
CREATE TABLE "seasons" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "financial_year" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seasons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "seasons_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "seasons_financial_year_check" CHECK ("financial_year" ~ '^[0-9]{2}-[0-9]{2}$')
);
CREATE UNIQUE INDEX "seasons_name_financial_year_ci_key" ON "seasons" (LOWER("name"), LOWER("financial_year"));
CREATE INDEX "seasons_status_idx" ON "seasons"("status");

CREATE TABLE "style_seasons" (
  "style_id" TEXT NOT NULL,
  "season_id" TEXT NOT NULL,
  CONSTRAINT "style_seasons_pkey" PRIMARY KEY ("style_id", "season_id"),
  CONSTRAINT "style_seasons_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "style_seasons_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "style_seasons_season_id_idx" ON "style_seasons"("season_id");

CREATE TABLE "purchase_order_line_season_snapshots" (
  "id" TEXT NOT NULL, "purchase_order_line_id" TEXT NOT NULL, "season_id" TEXT,
  "name" TEXT NOT NULL, "financial_year" TEXT NOT NULL, "display_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_line_season_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_line_season_snapshots_line_season_key" UNIQUE ("purchase_order_line_id", "season_id"),
  CONSTRAINT "purchase_order_line_season_snapshots_line_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "distributor_purchase_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "purchase_order_line_season_snapshots_season_id_idx" ON "purchase_order_line_season_snapshots"("season_id");

CREATE TABLE "job_order_season_snapshots" (
  "id" TEXT NOT NULL, "job_order_id" TEXT NOT NULL, "season_id" TEXT,
  "name" TEXT NOT NULL, "financial_year" TEXT NOT NULL, "display_name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_order_season_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_order_season_snapshots_order_season_key" UNIQUE ("job_order_id", "season_id"),
  CONSTRAINT "job_order_season_snapshots_order_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "job_order_season_snapshots_season_id_idx" ON "job_order_season_snapshots"("season_id");
