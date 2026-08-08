ALTER TABLE "qa_inspection_lines" ADD COLUMN "other_defect_details" TEXT;
ALTER TABLE "qa_inspection_lines" ADD CONSTRAINT "qa_inspection_lines_other_defect_details" CHECK (
  ("defect_category" = 'OTHER' AND "other_defect_details" IS NOT NULL AND btrim("other_defect_details") <> '')
  OR ("defect_category" IS DISTINCT FROM 'OTHER' AND "other_defect_details" IS NULL)
);
