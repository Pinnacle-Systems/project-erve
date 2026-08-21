-- PP Sample uses the SAMPLE Quality Form definition. Keep the shared
-- QaChecklistStatus enum unchanged for historical and other QA data.
UPDATE "quality_form_components" AS component
SET
  "config" = jsonb_set(component."config", '{responseOptions}', '["YES", "NO"]'::jsonb),
  "updated_at" = CURRENT_TIMESTAMP
FROM "quality_form_sections" AS section
JOIN "quality_form_versions" AS version
  ON version."id" = section."quality_form_version_id"
JOIN "quality_forms" AS form
  ON form."id" = version."quality_form_id"
WHERE component."quality_form_section_id" = section."id"
  AND component."type" = 'CHECKLIST'
  AND form."code" = 'SAMPLE';
