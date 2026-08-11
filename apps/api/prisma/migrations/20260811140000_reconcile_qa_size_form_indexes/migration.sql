-- Preserve historical migration immutability while converging databases that
-- received either pre-commit ERVE-015 index layout.
DO $$
BEGIN
  IF to_regclass('public.qa_size_inspection_forms_inspection_session_id_status_idx') IS NOT NULL THEN
    IF to_regclass('public.qa_size_inspection_forms_session_status_idx') IS NULL THEN
      ALTER INDEX "qa_size_inspection_forms_inspection_session_id_status_idx"
        RENAME TO "qa_size_inspection_forms_session_status_idx";
    ELSE
      DROP INDEX "qa_size_inspection_forms_inspection_session_id_status_idx";
    END IF;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "qa_size_inspection_forms_session_status_idx"
  ON "qa_size_inspection_forms"("inspection_session_id", "status");

CREATE INDEX IF NOT EXISTS "qa_size_inspection_forms_reopened_by_id_idx"
  ON "qa_size_inspection_forms"("reopened_by_id");
