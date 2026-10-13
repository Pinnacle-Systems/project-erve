BEGIN;
-- statement-breakpoint
CREATE TABLE "master_code_counters" (
  "namespace" TEXT NOT NULL PRIMARY KEY,
  "last_allocated_serial" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "master_code_counters_namespace_check" CHECK ("namespace" IN ('FAC', 'DST', 'STR')),
  CONSTRAINT "master_code_counters_serial_check" CHECK ("last_allocated_serial" >= 0)
);
-- statement-breakpoint
-- Keep existing codes intact and reserve every generated-looking legacy serial.
-- Stores keep their existing (distributor_id, code) uniqueness scope.
INSERT INTO "master_code_counters" ("namespace", "last_allocated_serial")
SELECT 'FAC', COALESCE(MAX(substring(code from 5)::bigint), 0) FROM "factories" WHERE code ~ '^FAC-[0-9]{6,}$'
UNION ALL
SELECT 'DST', COALESCE(MAX(substring(code from 5)::bigint), 0) FROM "distributors" WHERE code ~ '^DST-[0-9]{6,}$'
UNION ALL
SELECT 'STR', COALESCE(MAX(substring(code from 5)::bigint), 0) FROM "retail_stores" WHERE code ~ '^STR-[0-9]{6,}$';
-- statement-breakpoint
COMMIT;
