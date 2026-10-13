-- DEMO-008: optional per-participant remarks on PPM attendee rows.
-- Nullable, additive, no backfill — historical rows read as NULL and
-- older client payloads that omit this field are unaffected.
ALTER TABLE "quality_attendee_responses" ADD COLUMN "remarks" TEXT;
