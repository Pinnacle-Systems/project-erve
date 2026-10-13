BEGIN;
-- statement-breakpoint
-- Prevent a concurrent write between the preflight and index creation.
LOCK TABLE "distributors" IN ACCESS EXCLUSIVE MODE;
-- statement-breakpoint
DO $$
DECLARE collisions JSONB;
BEGIN
  SELECT jsonb_agg(collision ORDER BY collision.normalized_name, collision.purchase_mode)
  INTO collisions
  FROM (
    SELECT lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS normalized_name,
           purchase_mode,
           array_agg(id ORDER BY id) AS distributor_ids
    FROM "distributors"
    GROUP BY lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), purchase_mode
    HAVING count(*) > 1
  ) AS collision;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Distributor normalized name/Purchase Mode collisions: %. Resolve explicitly; no records have been merged or renamed.', collisions;
  END IF;
END $$;
-- statement-breakpoint
CREATE UNIQUE INDEX "distributors_normalized_name_purchase_mode_key"
ON "distributors" (lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), "purchase_mode");
-- statement-breakpoint
COMMIT;
