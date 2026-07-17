-- At most one primary image per style, enforced at the database level.
-- Prisma cannot express partial unique indexes in the schema, so this is a
-- raw index (same approach as price_lists_no_overlapping_active_periods);
-- schema.prisma documents it on the StyleImage model. The application's
-- per-style advisory lock keeps normal operations serialized — this index
-- is the independent backstop against any path that bypasses that lock.
CREATE UNIQUE INDEX "style_images_one_primary_per_style"
ON "style_images" ("style_id")
WHERE "is_primary" = true;
