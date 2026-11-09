CREATE TYPE "ReconciliationReviewAction" AS ENUM ('ACKNOWLEDGE', 'FOLLOW_UP', 'FINANCE_REVIEW');
CREATE TABLE "erve_dispatch_reconciliation_reviews" (
  "id" TEXT PRIMARY KEY,
  "erve_dispatch_id" TEXT NOT NULL REFERENCES "erve_dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actor_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actor_name" TEXT NOT NULL,
  "action" "ReconciliationReviewAction" NOT NULL,
  "remarks" TEXT NOT NULL CHECK (length(btrim("remarks")) BETWEEN 1 AND 2000),
  "snapshot_token" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "previous_review_id" TEXT UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "reconciliation_review_dispatch_history_idx"
  ON "erve_dispatch_reconciliation_reviews"("erve_dispatch_id", "created_at", "id");
CREATE FUNCTION reject_reconciliation_review_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reconciliation reviews are append-only';
END;
$$;
CREATE TRIGGER reconciliation_review_immutable BEFORE UPDATE OR DELETE
  ON "erve_dispatch_reconciliation_reviews" FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_review_mutation();
