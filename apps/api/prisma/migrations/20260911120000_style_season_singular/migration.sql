-- Correction 7: a Style belongs to exactly one Season. Confirmed business
-- practice: Styles are created for a specific Season and retired when it
-- ends; a later Season's need is met by creating a new Style, never by
-- re-pointing an existing one at another Season. The style_seasons
-- many-to-many join no longer reflects a real relationship and is replaced
-- by a required styles.season_id foreign key.
--
-- No backfill is performed. Unlike Financial Year (deterministically
-- computable from existing dates), a Style's Season cannot be safely guessed
-- from its style_seasons rows in every case (a Style with zero or more than
-- one existing mapping has no single unambiguous answer), and this
-- repository's own dev database has zero style_seasons rows for every
-- existing Style. This mirrors ERVE-016's own precedent
-- (20260805110000_add_season_code_and_snapshot_code): the required column is
-- added with no default, so this migration only applies cleanly to an empty
-- styles table. An existing database with Style rows must have its
-- disposable data reset (or be deliberately corrected with a real Season per
-- row) before this migration is applied — never invented here.
ALTER TABLE "styles" ADD COLUMN "season_id" TEXT NOT NULL;
ALTER TABLE "styles" ADD CONSTRAINT "styles_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "styles_season_id_idx" ON "styles"("season_id");

DROP TABLE "style_seasons";
