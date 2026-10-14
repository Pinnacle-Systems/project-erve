# Reference master imports and Excel images

Implement the supplied ERVE India bulk-import requirements within the existing create-only import architecture. Production, backup databases, customer files and customer images remain untouched. Work is isolated on `feature/master-imports-picture-in-cell`.

## Audit and design

`MasterImportRun`, `MasterImportSource` and `MasterImportRowResult` already accept string kinds and provide atomic provenance hooks, signed actor/file/worksheet/eligible-row confirmations and exception history. Extend their existing parser, router, service and React workflow with seasons, sizes and hsns. Authorize every route and execution using the current persisted actor, allowing ACCOUNTANT only for HSN. Use existing domain schemas, creation functions and audit logging with optional transactional hooks. Keep legacy business-import comparisons unchanged; reference masters compare all canonical fields, including nulls and inactive status. Size codes retain case and HSN codes retain literal digits. Reject numeric XLSX HSN cells with fewer than eight raw digits even if their display format pads them. Reject GST configuration headers for HSN.

Season identity is code plus Financial Year ID; resolve Financial Year by code. Preserve absent serial as null and show a warning. The raw SQL expression index `seasons_financial_year_id_code_ci_key`, created in `20260826120000_add_financial_year_documents`, already enforces case-insensitive code plus Financial Year uniqueness; no additional Season index is needed. The existing globally unique barcode serial remains authoritative. Expand the existing import-run kind check and add the same supported-kind check to provenance in a forward-only migration.

Keep the synchronous extraction API for legacy callers. Resolve modern cells through vm -> valueMetadata -> metadata type -> named futureMetadata -> rich value -> its declared structure key -> local relationship or cached web blip -> packaged media. Resolve relationships relative to their owner; never fetch external targets. Add an asynchronous normalization wrapper using the existing sharp dependency, validating decoded PNG/JPEG integrity and dimensions, retaining native PNG bytes and original/normalized checksums. Deduplicate only the same cell/media association across representations. Preserve genuine multiple pictures. Reject malformed mappings and make recognizable metadata with zero extracted images a preflight failure. Keep existing Style transaction, storage and recovery machinery.

Reuse the shared import UI with master-specific columns, existing compact controls, routes and listing actions; invalidate master queries after execution. Describe both image formats in Style help/template instructions without new business-column aliases.

## Acceptance

Synthetic automated fixtures cover reference rules, authorization, confirmation, concurrency, rollback/provenance and legacy/modern image mapping/conversion. An explicitly isolated disposable database and media directory prove persisted Styles and images. Real-source validation stays local and reports aggregate counts only. Run relevant backend/frontend suites, typecheck, lint and production builds. Document preflight, deployment prerequisites and smoke tests. Never deploy or reset production.
