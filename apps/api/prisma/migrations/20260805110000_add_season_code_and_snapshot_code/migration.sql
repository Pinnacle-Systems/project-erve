-- ERVE-016 follow-up. These required fields intentionally have no default:
-- existing rows cannot be safely converted because a short operational value
-- must not be guessed as a descriptive name or vice versa. Reset disposable
-- Season/transaction data (or correct it deliberately) before applying this
-- migration to a database that already contains such rows.
ALTER TABLE "seasons" ADD COLUMN "code" TEXT NOT NULL;
ALTER TABLE "purchase_order_line_season_snapshots" ADD COLUMN "code" TEXT NOT NULL;
ALTER TABLE "job_order_season_snapshots" ADD COLUMN "code" TEXT NOT NULL;

CREATE UNIQUE INDEX "seasons_code_financial_year_ci_key"
  ON "seasons" (LOWER("code"), LOWER("financial_year"));
