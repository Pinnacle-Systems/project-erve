-- DEMO-005: add an explicit, distinct N/A checklist response for PP Sample.
-- Additive only — existing YES/NO/AVAILABLE rows and their meaning are
-- unaffected, and unanswered remains represented by NULL, not this value.
ALTER TYPE "QaChecklistStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';
