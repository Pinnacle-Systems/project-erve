ALTER TABLE "qa_size_inspection_forms"
  DROP CONSTRAINT "qa_size_inspection_forms_defect_required";

ALTER TABLE "qa_size_inspection_forms"
  ADD CONSTRAINT "qa_size_inspection_forms_defect_required" CHECK (
    "status" <> 'FINALIZED'
    OR ("rework_quantity" = 0 AND "permanently_rejected_quantity" = 0)
    OR "defect_category" IS NOT NULL
  );

ALTER TABLE "qa_size_inspection_forms"
  DROP CONSTRAINT "qa_size_inspection_forms_other_defect_details";

ALTER TABLE "qa_size_inspection_forms"
  ADD CONSTRAINT "qa_size_inspection_forms_other_defect_details" CHECK (
    ("other_defect_details" IS NULL OR "other_defect_details" ~ '[^[:space:]]')
    AND ("defect_category" = 'OTHER' OR "other_defect_details" IS NULL)
    AND (
      "status" <> 'FINALIZED'
      OR "defect_category" IS DISTINCT FROM 'OTHER'
      OR ("other_defect_details" IS NOT NULL AND "other_defect_details" ~ '[^[:space:]]')
    )
  );
