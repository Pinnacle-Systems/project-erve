ALTER TABLE "qa_size_inspection_forms"
  DROP CONSTRAINT "qa_size_inspection_forms_other_defect_details";

ALTER TABLE "qa_size_inspection_forms"
  ADD CONSTRAINT "qa_size_inspection_forms_other_defect_details" CHECK (
    ("defect_category" = 'OTHER' AND "other_defect_details" IS NOT NULL AND "other_defect_details" ~ '[^[:space:]]')
    OR ("defect_category" IS DISTINCT FROM 'OTHER' AND "other_defect_details" IS NULL)
  );
