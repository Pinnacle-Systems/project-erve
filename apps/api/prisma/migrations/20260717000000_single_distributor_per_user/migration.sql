-- A distributor user belongs to exactly one distributor. The application
-- also enforces this in the mapping service; this constraint makes the
-- invariant hold at the database level.

-- DropIndex
DROP INDEX "user_distributors_user_id_distributor_id_key";

-- DropIndex
DROP INDEX "user_distributors_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "user_distributors_user_id_key" ON "user_distributors"("user_id");
