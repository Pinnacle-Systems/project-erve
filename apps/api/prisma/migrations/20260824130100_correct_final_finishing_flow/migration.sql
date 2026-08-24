-- Introduce an immutable forward Process Flow version in which Final Inspection
-- consumes Production-declared Finishing output progressively. Fresh databases
-- have no reference data until seeding, so absence is an intentional no-op.
DO $migration$
DECLARE
  flow_id TEXT;
  source_version_id TEXT;
  forward_version_id TEXT;
  finishing_source_id TEXT;
BEGIN
  SELECT pf."id" INTO flow_id
  FROM "process_flows" pf
  WHERE pf."code" = 'ERVE_PRODUCTION_QUALITY';

  IF flow_id IS NULL THEN
    RETURN;
  END IF;

  SELECT pfv."id" INTO source_version_id
  FROM "process_flow_versions" pfv
  WHERE pfv."process_flow_id" = flow_id
  ORDER BY pfv."version_number" DESC
  LIMIT 1;

  SELECT pfv."id" INTO forward_version_id
  FROM "process_flow_versions" pfv
  WHERE pfv."process_flow_id" = flow_id AND pfv."version_number" = 3;

  IF forward_version_id IS NULL THEN
    forward_version_id := 'pfv_erve_v3_' || md5(flow_id);

    INSERT INTO "process_flow_versions" (
      "id", "process_flow_id", "version_number", "status", "effective_from", "created_at", "updated_at"
    ) VALUES (
      forward_version_id, flow_id, 3, 'RETIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    CREATE TEMP TABLE "erve_v3_activity_id_map" (
      "old_id" TEXT PRIMARY KEY,
      "new_id" TEXT NOT NULL UNIQUE
    ) ON COMMIT DROP;

    INSERT INTO "erve_v3_activity_id_map" ("old_id", "new_id")
    SELECT s."id", 'pfvs_erve_v3_' || md5(s."id")
    FROM "process_flow_version_stages" s
    WHERE s."process_flow_version_id" = source_version_id;

    INSERT INTO "process_flow_version_stages" (
      "id", "process_flow_version_id", "sequence", "name", "code", "status",
      "activity_type", "quality_form_version_id", "quality_execution_mode",
      "associated_production_activity_id", "quality_availability_policy",
      "progress_threshold_percent", "gate_satisfaction_requirement",
      "execution_multiplicity", "coverage_target", "created_at", "updated_at"
    )
    SELECT map."new_id", forward_version_id, s."sequence", s."name", s."code", s."status",
      s."activity_type", NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "process_flow_version_stages" s
    JOIN "erve_v3_activity_id_map" map ON map."old_id" = s."id"
    WHERE s."process_flow_version_id" = source_version_id
      AND s."activity_type" = 'PRODUCTION'
    ORDER BY s."sequence";

    SELECT map."new_id" INTO finishing_source_id
    FROM "process_flow_version_stages" s
    JOIN "erve_v3_activity_id_map" map ON map."old_id" = s."id"
    WHERE s."process_flow_version_id" = source_version_id
      AND s."activity_type" = 'PRODUCTION'
      AND s."code" = 'FINISHING';

    IF finishing_source_id IS NULL THEN
      RAISE EXCEPTION 'Cannot create forward Final workflow: FINISHING activity is missing';
    END IF;

    INSERT INTO "process_flow_version_stages" (
      "id", "process_flow_version_id", "sequence", "name", "code", "status",
      "activity_type", "quality_form_version_id", "quality_execution_mode",
      "associated_production_activity_id", "quality_availability_policy",
      "progress_threshold_percent", "gate_satisfaction_requirement",
      "execution_multiplicity", "coverage_target", "created_at", "updated_at"
    )
    SELECT map."new_id", forward_version_id, s."sequence", s."name", s."code", s."status",
      s."activity_type", s."quality_form_version_id", s."quality_execution_mode",
      CASE WHEN s."code" = 'FINAL' THEN finishing_source_id ELSE associated_map."new_id" END,
      CASE WHEN s."code" = 'FINAL' THEN 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'::"QualityAvailabilityPolicy" ELSE s."quality_availability_policy" END,
      CASE WHEN s."code" = 'FINAL' THEN NULL ELSE s."progress_threshold_percent" END,
      s."gate_satisfaction_requirement", s."execution_multiplicity", s."coverage_target",
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM "process_flow_version_stages" s
    JOIN "erve_v3_activity_id_map" map ON map."old_id" = s."id"
    LEFT JOIN "erve_v3_activity_id_map" associated_map
      ON associated_map."old_id" = s."associated_production_activity_id"
    WHERE s."process_flow_version_id" = source_version_id
      AND s."activity_type" = 'QUALITY'
    ORDER BY s."sequence";
  END IF;

  UPDATE "process_flow_versions"
  SET "status" = 'RETIRED', "updated_at" = CURRENT_TIMESTAMP
  WHERE "process_flow_id" = flow_id AND "id" <> forward_version_id AND "status" = 'ACTIVE';

  UPDATE "process_flow_versions"
  SET "status" = 'ACTIVE', "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = forward_version_id;
END $migration$;
