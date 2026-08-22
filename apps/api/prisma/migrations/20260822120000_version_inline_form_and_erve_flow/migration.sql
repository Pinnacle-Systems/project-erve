-- Forward-only reference-data transition for the state-only Production workflow.
--
-- Fresh databases apply migrations before seed data exists, so absence of both
-- source definitions is an intentional no-op. Existing databases clone the
-- immutable v1 definitions and preserve every historical foreign key.
DO $migration$
DECLARE
  inline_form_id TEXT;
  inline_v1_id TEXT;
  inline_v2_id TEXT;
  inline_v1_progress_count INTEGER;
  inline_expected JSONB;
  inline_actual JSONB;
  erve_flow_id TEXT;
  erve_v1_id TEXT;
  erve_v2_id TEXT;
  erve_inline_activity_count INTEGER;
  erve_expected JSONB;
  erve_actual JSONB;
BEGIN
  SELECT qf."id"
  INTO inline_form_id
  FROM "quality_forms" qf
  WHERE qf."code" = 'INLINE';

  IF inline_form_id IS NOT NULL THEN
    SELECT qfv."id"
    INTO inline_v1_id
    FROM "quality_form_versions" qfv
    WHERE qfv."quality_form_id" = inline_form_id
      AND qfv."version_number" = 1;

    SELECT qfv."id"
    INTO inline_v2_id
    FROM "quality_form_versions" qfv
    WHERE qfv."quality_form_id" = inline_form_id
      AND qfv."version_number" = 2;
  END IF;

  SELECT pf."id"
  INTO erve_flow_id
  FROM "process_flows" pf
  WHERE pf."code" = 'ERVE_PRODUCTION_QUALITY';

  IF erve_flow_id IS NOT NULL THEN
    SELECT pfv."id"
    INTO erve_v1_id
    FROM "process_flow_versions" pfv
    WHERE pfv."process_flow_id" = erve_flow_id
      AND pfv."version_number" = 1;

    SELECT pfv."id"
    INTO erve_v2_id
    FROM "process_flow_versions" pfv
    WHERE pfv."process_flow_id" = erve_flow_id
      AND pfv."version_number" = 2;
  END IF;

  -- A pristine database has no seeded reference data yet. Seed runs after all
  -- migrations and creates the converged v1/v2 definitions itself.
  IF inline_form_id IS NULL AND erve_flow_id IS NULL THEN
    RETURN;
  END IF;

  IF inline_form_id IS NULL OR inline_v1_id IS NULL THEN
    RAISE EXCEPTION 'Cannot version Inline Inspection: INLINE Quality Form v1 is missing';
  END IF;
  IF erve_flow_id IS NULL OR erve_v1_id IS NULL THEN
    RAISE EXCEPTION 'Cannot version Erve Process Flow: ERVE_PRODUCTION_QUALITY v1 is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "quality_form_sections" s
    WHERE s."quality_form_version_id" = inline_v1_id
  ) THEN
    RAISE EXCEPTION 'Cannot version Inline Inspection: v1 has no sections';
  END IF;

  SELECT COUNT(*)
  INTO inline_v1_progress_count
  FROM "quality_form_sections" s
  JOIN "quality_form_components" c ON c."quality_form_section_id" = s."id"
  WHERE s."quality_form_version_id" = inline_v1_id
    AND c."type" = 'PRODUCTION_PROGRESS';

  IF inline_v1_progress_count <> 1 THEN
    RAISE EXCEPTION 'Cannot version Inline Inspection: expected exactly one PRODUCTION_PROGRESS component in v1, found %', inline_v1_progress_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "quality_form_sections" s
    WHERE s."quality_form_version_id" = inline_v1_id
      AND NOT EXISTS (
        SELECT 1
        FROM "quality_form_components" c
        WHERE c."quality_form_section_id" = s."id"
          AND c."type" <> 'PRODUCTION_PROGRESS'
      )
  ) THEN
    RAISE EXCEPTION 'Cannot version Inline Inspection: removing PRODUCTION_PROGRESS would leave an empty section';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "process_flow_version_stages" s
    WHERE s."process_flow_version_id" = erve_v1_id
  ) THEN
    RAISE EXCEPTION 'Cannot version Erve Process Flow: v1 has no activities';
  END IF;

  SELECT COUNT(*)
  INTO erve_inline_activity_count
  FROM "process_flow_version_stages" s
  WHERE s."process_flow_version_id" = erve_v1_id
    AND s."activity_type" = 'QUALITY'
    AND s."code" = 'INLINE'
    AND s."quality_form_version_id" = inline_v1_id;

  IF erve_inline_activity_count <> 1 THEN
    RAISE EXCEPTION 'Cannot version Erve Process Flow: expected exactly one v1 INLINE Quality activity linked to Inline v1, found %', erve_inline_activity_count;
  END IF;

  -- Canonical expected Inline v2 definition: v1 sections are unchanged;
  -- components retain their order and are compactly resequenced after the
  -- unsupported component is omitted, matching the seed implementation.
  SELECT COALESCE(jsonb_agg(section_row."definition" ORDER BY section_row."sequence"), '[]'::jsonb)
  INTO inline_expected
  FROM (
    SELECT s."sequence",
      jsonb_build_object(
        'sequence', s."sequence",
        'title', s."title",
        'description', s."description",
        'components', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'sequence', component_row."normalized_sequence",
              'type', component_row."type",
              'title', component_row."title",
              'description', component_row."description",
              'config', component_row."config"
            ) ORDER BY component_row."normalized_sequence"
          )
          FROM (
            SELECT ROW_NUMBER() OVER (ORDER BY c."sequence")::INTEGER AS "normalized_sequence",
              c."type", c."title", c."description", c."config"
            FROM "quality_form_components" c
            WHERE c."quality_form_section_id" = s."id"
              AND c."type" <> 'PRODUCTION_PROGRESS'
          ) component_row
        ), '[]'::jsonb)
      ) AS "definition"
    FROM "quality_form_sections" s
    WHERE s."quality_form_version_id" = inline_v1_id
  ) section_row;

  IF inline_v2_id IS NULL THEN
    inline_v2_id := 'qfv_inline_v2_' || md5(inline_form_id);

    INSERT INTO "quality_form_versions" (
      "id", "quality_form_id", "version_number", "activity_type", "execution_scope",
      "status", "published_at", "created_at", "updated_at"
    )
    SELECT inline_v2_id, v1."quality_form_id", 2, v1."activity_type", v1."execution_scope",
      'RETIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "quality_form_versions" v1
    WHERE v1."id" = inline_v1_id;

    INSERT INTO "quality_form_sections" (
      "id", "quality_form_version_id", "sequence", "title", "description", "created_at", "updated_at"
    )
    SELECT 'qfs_inline_v2_' || md5(s."id"), inline_v2_id, s."sequence", s."title",
      s."description", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "quality_form_sections" s
    WHERE s."quality_form_version_id" = inline_v1_id
    ORDER BY s."sequence";

    INSERT INTO "quality_form_components" (
      "id", "quality_form_section_id", "sequence", "type", "title", "description",
      "config", "created_at", "updated_at"
    )
    SELECT 'qfc_inline_v2_' || md5(c."id"), 'qfs_inline_v2_' || md5(s."id"),
      ROW_NUMBER() OVER (PARTITION BY s."id" ORDER BY c."sequence")::INTEGER,
      c."type", c."title", c."description", c."config", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "quality_form_sections" s
    JOIN "quality_form_components" c ON c."quality_form_section_id" = s."id"
    WHERE s."quality_form_version_id" = inline_v1_id
      AND c."type" <> 'PRODUCTION_PROGRESS'
    ORDER BY s."sequence", c."sequence";
  END IF;

  SELECT COALESCE(jsonb_agg(section_row."definition" ORDER BY section_row."sequence"), '[]'::jsonb)
  INTO inline_actual
  FROM (
    SELECT s."sequence",
      jsonb_build_object(
        'sequence', s."sequence",
        'title', s."title",
        'description', s."description",
        'components', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'sequence', c."sequence",
              'type', c."type",
              'title', c."title",
              'description', c."description",
              'config', c."config"
            ) ORDER BY c."sequence"
          )
          FROM "quality_form_components" c
          WHERE c."quality_form_section_id" = s."id"
        ), '[]'::jsonb)
      ) AS "definition"
    FROM "quality_form_sections" s
    WHERE s."quality_form_version_id" = inline_v2_id
  ) section_row;

  IF inline_actual IS DISTINCT FROM inline_expected THEN
    RAISE EXCEPTION 'Existing Inline Inspection v2 is not the expected immutable v1 copy without PRODUCTION_PROGRESS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "quality_form_versions" v1
    JOIN "quality_form_versions" v2 ON v2."id" = inline_v2_id
    WHERE v1."id" = inline_v1_id
      AND (v1."activity_type" <> v2."activity_type" OR v1."execution_scope" <> v2."execution_scope")
  ) THEN
    RAISE EXCEPTION 'Existing Inline Inspection v2 has different execution semantics from v1';
  END IF;

  -- Build the expected v2 graph independently of activity IDs. Associated
  -- Production references are represented by the associated activity's
  -- unique sequence so a pre-existing v2 can be validated structurally.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sequence', s."sequence",
      'name', s."name",
      'code', s."code",
      'status', s."status",
      'activityType', s."activity_type",
      'qualityFormVersionId', CASE
        WHEN s."activity_type" = 'QUALITY' AND s."code" = 'INLINE' THEN inline_v2_id
        ELSE s."quality_form_version_id"
      END,
      'qualityExecutionMode', s."quality_execution_mode",
      'associatedProductionSequence', associated."sequence",
      'qualityAvailabilityPolicy', s."quality_availability_policy",
      'progressThresholdPercent', s."progress_threshold_percent",
      'gateSatisfactionRequirement', s."gate_satisfaction_requirement",
      'executionMultiplicity', s."execution_multiplicity",
      'coverageTarget', s."coverage_target"
    ) ORDER BY s."sequence"
  ), '[]'::jsonb)
  INTO erve_expected
  FROM "process_flow_version_stages" s
  LEFT JOIN "process_flow_version_stages" associated
    ON associated."id" = s."associated_production_activity_id"
  WHERE s."process_flow_version_id" = erve_v1_id;

  IF erve_v2_id IS NULL THEN
    erve_v2_id := 'pfv_erve_v2_' || md5(erve_flow_id);

    INSERT INTO "process_flow_versions" (
      "id", "process_flow_id", "version_number", "status", "effective_from", "created_at", "updated_at"
    )
    SELECT erve_v2_id, v1."process_flow_id", 2, 'RETIRED', CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "process_flow_versions" v1
    WHERE v1."id" = erve_v1_id;

    CREATE TEMP TABLE "erve_v2_activity_id_map" (
      "old_id" TEXT PRIMARY KEY,
      "new_id" TEXT NOT NULL UNIQUE
    ) ON COMMIT DROP;

    INSERT INTO "erve_v2_activity_id_map" ("old_id", "new_id")
    SELECT s."id", 'pfvs_erve_v2_' || md5(s."id")
    FROM "process_flow_version_stages" s
    WHERE s."process_flow_version_id" = erve_v1_id;

    -- Production activities must exist before Quality activities because the
    -- database trigger validates same-version Production associations.
    INSERT INTO "process_flow_version_stages" (
      "id", "process_flow_version_id", "sequence", "name", "code", "status",
      "activity_type", "quality_form_version_id", "quality_execution_mode",
      "associated_production_activity_id", "quality_availability_policy",
      "progress_threshold_percent", "gate_satisfaction_requirement",
      "execution_multiplicity", "coverage_target", "created_at", "updated_at"
    )
    SELECT map."new_id", erve_v2_id, s."sequence", s."name", s."code", s."status",
      s."activity_type", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "process_flow_version_stages" s
    JOIN "erve_v2_activity_id_map" map ON map."old_id" = s."id"
    WHERE s."process_flow_version_id" = erve_v1_id
      AND s."activity_type" = 'PRODUCTION'
    ORDER BY s."sequence";

    INSERT INTO "process_flow_version_stages" (
      "id", "process_flow_version_id", "sequence", "name", "code", "status",
      "activity_type", "quality_form_version_id", "quality_execution_mode",
      "associated_production_activity_id", "quality_availability_policy",
      "progress_threshold_percent", "gate_satisfaction_requirement",
      "execution_multiplicity", "coverage_target", "created_at", "updated_at"
    )
    SELECT map."new_id", erve_v2_id, s."sequence", s."name", s."code", s."status",
      s."activity_type",
      CASE WHEN s."code" = 'INLINE' THEN inline_v2_id ELSE s."quality_form_version_id" END,
      s."quality_execution_mode", associated_map."new_id", s."quality_availability_policy",
      s."progress_threshold_percent", s."gate_satisfaction_requirement",
      s."execution_multiplicity", s."coverage_target", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "process_flow_version_stages" s
    JOIN "erve_v2_activity_id_map" map ON map."old_id" = s."id"
    LEFT JOIN "erve_v2_activity_id_map" associated_map
      ON associated_map."old_id" = s."associated_production_activity_id"
    WHERE s."process_flow_version_id" = erve_v1_id
      AND s."activity_type" = 'QUALITY'
    ORDER BY s."sequence";
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'sequence', s."sequence",
      'name', s."name",
      'code', s."code",
      'status', s."status",
      'activityType', s."activity_type",
      'qualityFormVersionId', s."quality_form_version_id",
      'qualityExecutionMode', s."quality_execution_mode",
      'associatedProductionSequence', associated."sequence",
      'qualityAvailabilityPolicy', s."quality_availability_policy",
      'progressThresholdPercent', s."progress_threshold_percent",
      'gateSatisfactionRequirement', s."gate_satisfaction_requirement",
      'executionMultiplicity', s."execution_multiplicity",
      'coverageTarget', s."coverage_target"
    ) ORDER BY s."sequence"
  ), '[]'::jsonb)
  INTO erve_actual
  FROM "process_flow_version_stages" s
  LEFT JOIN "process_flow_version_stages" associated
    ON associated."id" = s."associated_production_activity_id"
  WHERE s."process_flow_version_id" = erve_v2_id;

  IF erve_actual IS DISTINCT FROM erve_expected THEN
    RAISE EXCEPTION 'Existing Erve Process Flow v2 is not the expected immutable clone of v1 linked to Inline v2';
  END IF;

  -- Converge lifecycle state only after both immutable v2 definitions have
  -- passed structural validation. Order avoids the partial unique indexes
  -- that allow only one published form / active flow version at a time.
  UPDATE "quality_form_versions"
  SET "status" = 'RETIRED', "published_at" = COALESCE("published_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = inline_v1_id;

  UPDATE "quality_form_versions"
  SET "status" = 'PUBLISHED', "published_at" = COALESCE("published_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = inline_v2_id;

  UPDATE "process_flow_versions"
  SET "status" = 'RETIRED', "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = erve_v1_id;

  UPDATE "process_flow_versions"
  SET "status" = 'ACTIVE', "effective_from" = COALESCE("effective_from", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = erve_v2_id;
END
$migration$;
