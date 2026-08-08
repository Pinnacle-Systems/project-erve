ALTER TABLE "qa_evidence"
  DROP CONSTRAINT "qa_evidence_inspection_session_id_checksum_sha256_key";

ALTER TABLE "qa_evidence"
  ADD CONSTRAINT "qa_evidence_inspection_session_id_inspection_line_id_checksum_sha256_key"
  UNIQUE ("inspection_session_id", "inspection_line_id", "checksum_sha256");
