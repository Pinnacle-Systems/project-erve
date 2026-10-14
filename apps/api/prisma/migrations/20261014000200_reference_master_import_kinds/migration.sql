-- Expand existing audit/provenance kinds; keep all previous kinds valid.
BEGIN;
ALTER TABLE master_import_runs DROP CONSTRAINT master_import_runs_kind_check;
ALTER TABLE master_import_runs ADD CONSTRAINT master_import_runs_kind_check
  CHECK (kind IN ('factories', 'distributors', 'retail-stores', 'seasons', 'sizes', 'hsns'));
ALTER TABLE master_import_sources DROP CONSTRAINT IF EXISTS master_import_sources_kind_check;
ALTER TABLE master_import_sources ADD CONSTRAINT master_import_sources_kind_check
  CHECK (kind IN ('factories', 'distributors', 'retail-stores', 'seasons', 'sizes', 'hsns'));
COMMIT;
