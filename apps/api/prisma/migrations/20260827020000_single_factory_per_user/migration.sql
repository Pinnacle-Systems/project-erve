-- A factory user belongs to exactly one factory (mirrors the
-- single_distributor_per_user migration). The application also enforces
-- this in the mapping service; this constraint makes the invariant hold at
-- the database level.
--
-- This will fail if any user_id currently has more than one row in
-- user_factories — that data must be resolved (each affected user
-- explicitly reassigned to a single factory) before this migration can be
-- applied. As of writing, no such rows exist in any tracked environment.

-- DropIndex
DROP INDEX "user_factories_user_id_factory_id_key";

-- DropIndex
DROP INDEX "user_factories_user_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "user_factories_user_id_key" ON "user_factories"("user_id");
