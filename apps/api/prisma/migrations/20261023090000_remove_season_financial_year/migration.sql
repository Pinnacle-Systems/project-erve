-- ISS-SEASON-FY: remove Financial Year from Season entirely. Season
-- identity becomes its Code alone, globally unique (case-insensitive,
-- trimmed), independent of status and Financial Year. Transaction
-- documents (OS/JO/DO/invoices) are untouched here — they already resolve
-- their own Financial Year from their own date, never from Season.

-- 1. Explicit pre-flight duplicate check, with a clear diagnostic listing
--    every colliding normalized code and how many rows share it. This is
--    deliberately separate from (and ahead of) the CREATE UNIQUE INDEX
--    below so an operator gets an actionable error instead of Postgres's
--    terse "duplicate key value violates unique constraint", and so this
--    migration never automatically merges, deletes, or renames a Season
--    row to force uniqueness.
DO $$
DECLARE
  duplicate_codes TEXT;
BEGIN
  SELECT string_agg(format('%s (%s rows)', normalized_code, row_count), ', ')
  INTO duplicate_codes
  FROM (
    SELECT UPPER(TRIM(code)) AS normalized_code, COUNT(*) AS row_count
    FROM "seasons"
    GROUP BY UPPER(TRIM(code))
    HAVING COUNT(*) > 1
  ) dupes;

  IF duplicate_codes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot make Season Code globally unique: duplicate normalized code(s) found: %. Resolve these manually (this migration never merges, deletes, or renames Season rows) before retrying.',
      duplicate_codes;
  END IF;
END $$;

-- 2. Drop the old (financial_year_id, code) composite uniqueness and its
--    supporting FK/column — Season no longer has a Financial Year.
DROP INDEX "seasons_financial_year_id_code_ci_key";
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_financial_year_id_fkey";
ALTER TABLE "seasons" DROP COLUMN "financial_year_id";

-- 3. Season Code is now globally unique, case-insensitive, trimmed —
--    enforced at the database level independent of the application-level
--    uppercase/trim normalization in master-data.validation.ts.
CREATE UNIQUE INDEX "seasons_code_ci_key" ON "seasons" (UPPER(TRIM(code)));

-- 4. The Order Sheet / Job Order Season snapshot tables carried a
--    per-snapshot Financial Year label and a precomputed Code+FY display
--    string. Season has no Financial Year any more, so neither column has
--    a live-data source going forward — the display label is always
--    derived from `code` at read time instead. The snapshot FEATURE itself
--    (freezing a Style's Season identity at Order Sheet/Job Order creation
--    time) is unaffected.
ALTER TABLE "purchase_order_line_season_snapshots" DROP COLUMN "financial_year";
ALTER TABLE "purchase_order_line_season_snapshots" DROP COLUMN "display_name";
ALTER TABLE "job_order_season_snapshots" DROP COLUMN "financial_year";
ALTER TABLE "job_order_season_snapshots" DROP COLUMN "display_name";
