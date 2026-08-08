ALTER TABLE "qa_inspection_lines"
  DROP CONSTRAINT "qa_inspection_lines_other_defect_details";

ALTER TABLE "qa_inspection_lines"
  ADD CONSTRAINT "qa_inspection_lines_other_defect_details" CHECK (
    ("defect_category" = 'OTHER' AND "other_defect_details" IS NOT NULL AND "other_defect_details" ~ '[^[:space:]]')
    OR ("defect_category" IS DISTINCT FROM 'OTHER' AND "other_defect_details" IS NULL)
  );
