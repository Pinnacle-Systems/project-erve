# Reference master imports and Excel pictures

The existing create-only import workflow now supports Seasons, Sizes and HSN identity. The shared parser, confirmation tokens, provenance, per-row results, history and exception reports remain the implementation path. Domain creation and audit logging run in the same transaction as import provenance and successful row outcomes.

## Entry points and permissions

| Master | Listing import action | Allowed roles |
| --- | --- | --- |
| Season | `/master-data/seasons/import` | ADMIN, MERCHANDISER |
| Size | `/master-data/sizes/import` | ADMIN, MERCHANDISER |
| HSN | `/hsns/import` | ADMIN, MERCHANDISER, ACCOUNTANT |

For each kind (`seasons`, `sizes`, `hsns`), the existing `/master-imports/:kind` router exposes GET `template`, POST `worksheets`, POST `preflight`, POST `exceptions`, POST `execute`, GET `history`, GET `history/:runId`, and GET `history/:runId/exceptions`. Every route checks current persisted actor permissions. ACCOUNTANT cannot access the other shared import kinds. HSN import rejects GST configuration headers and never assigns a GST Rule Set.

Download the XLSX template, upload XLSX/CSV, explicitly select an XLSX worksheet, preview, download exceptions, and confirm. Confirmation expires after 15 minutes and binds the actor, kind, file checksum, worksheet and eligible row fingerprints. Existing records are never overwritten. Master listing queries refresh after execution. Exact inactive reference masters are skipped when the uploaded status is also INACTIVE; different metadata requires review.

Season identity is case-insensitive code plus Financial Year. The Financial Year code must already exist. Blank Barcode Serial stays NULL and produces a warning; supplied serials use existing positive-integer validation and global uniqueness. Size Code is kept verbatim after the existing trimming validation. HSN Code stays a string; store it as text in Excel to preserve all eight digits. Numeric cells with fewer than eight raw digits are rejected even if Excel displays a zero-padded number. No software can reconstruct digits already discarded by Excel, or detect an original longer code that has become an otherwise valid eight-digit value; inspect the original source when in doubt.

## Database audit and migration

Season uniqueness is already enforced by the raw expression index `seasons_financial_year_id_code_ci_key`, created in `20260826120000_add_financial_year_documents`. Prisma cannot express this case-insensitive index; the absence of `@@unique` in its model does not mean enforcement is absent. Barcode Serial and Size/HSN codes also have database unique indexes. No new table or Season uniqueness migration is required.

`20261014000200_reference_master_import_kinds` expands the import-run allowed-kind check and adds an equivalent provenance-kind check. It changes no business rows and is enclosed in a transaction. Existing unsupported provenance kinds cause validation to fail and the transaction to roll back; investigate those records explicitly instead of removing them. The migration is forward-only. Do not edit an applied migration or roll schema back after new kinds have been imported.

Before separately authorized deployment, run these read-only checks against the intended database:

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'seasons'
  AND indexname = 'seasons_financial_year_id_code_ci_key';

SELECT lower(code), financial_year_id, count(*), array_agg(id ORDER BY id)
FROM seasons GROUP BY lower(code), financial_year_id HAVING count(*) > 1;

SELECT kind, count(*) FROM master_import_sources
WHERE kind NOT IN ('factories', 'distributors', 'retail-stores', 'seasons', 'sizes', 'hsns')
GROUP BY kind;
```

Missing identity enforcement, duplicate business data or unsupported provenance kinds are deployment blockers requiring explicit investigation. Do not delete or merge records automatically. Confirm migration history matches the release, rehearse migration replay on a fresh disposable database, and retain the existing backup/restore process. Apply the new migration before releasing the new import endpoints. Production deployment and the customer UAT reset require separate authorization.

## Excel image support

`xlsx-embedded-images.ts` retains the synchronous row-extraction interface for existing callers. Style import uses the asynchronous normalized wrapper. Legacy one-cell/two-cell drawing anchors and modern Picture-in-Cell images resolve to physical rows on the selected worksheet. Modern resolution follows worksheet `vm`, value metadata, the declared metadata type, named future metadata, the rich value's structure and identifier key, then either a local image relationship or a cached web-image blip. Workbook relationship targets are resolved relative to their owning part. External addresses are never fetched.

Formats are detected from signatures and fully decoded with the existing sharp dependency. PNG bytes remain unchanged. JPEG bytes, including JPEGs under PNG filenames, become validated PNGs. The extraction wrapper bounds each image to 10 MB and 20 million pixels; the existing configurable image-upload limit still applies before storage. Original and normalized checksums and physical package/cell provenance are retained for modern/JPEG imports. Ambiguous ownership, malformed metadata, missing media and corrupt content produce exceptions. Recognizable image metadata with no valid extracted images blocks preflight. Ordinary workbooks and valid non-image rich cells do not require pictures.

Only the same media/cell association across legacy and modern representations is deduplicated. Distinct picture occurrences with identical contents remain separate gallery entries; occurrence-aware storage attachment and recovery remain repeatable. Existing galleries with different expected image content require review and are never overwritten. Style preview continues showing image counts and exceptions. Template instructions describe anchored and Picture-in-Cell pictures without requiring a filename, URL or base64 column.

## Historical workbook normalization

Image compatibility does not authorize historical business-data imports. The AW26 engineering source uses `Heads`, `Base code`, `Description`, `Season`, `MRP`, factory names and other historical headings. They are not automatic aliases for generic Style import fields.

Prepare an explicitly reviewed working copy: map a verified Base code to Style Number, supply a verified Style Name and Final MRP, resolve Season Code and Financial Year to existing masters, and supply valid Size Codes plus LMIX Number or explicit per-size Barcodes. Normalize factory mappings only from verified factory masters and prices. Preserve physical picture rows while changing business headers. Do not guess missing Sizes, barcode prerequisites, ambiguous Seasons or repeated factory columns. Customer artifacts, extracted pictures, source-row evidence and credentials remain outside Git.

Engineering storage validation uses synthetic business identities and explicit disposable prerequisites while preserving the source's physical image metadata. This proves image extraction/storage/association without treating historical rows as eligible for creation. The local engineering artifact may have a different filename from the requested `(2)` variant; report that distinction when providing reconciliation results.

## Verification and post-deployment smoke tests

Run the backend master-data/tax-rules suites, image extractor and source-normalization tests with an explicitly isolated TEST_DATABASE_URL. The test harness refuses missing or non-test database names and uses temporary test uploads. Run frontend master-data and registered route suites, workspace typecheck, lint and production builds. Synthetic OOXML tests cover local/cached web images, nontrivial indices, corrupt/unsupported media, duplicate/ambiguous mappings, equal-content occurrences and PNG/JPEG normalization. Integration tests cover domain validation, permissions, exact/conflicting records, stale confirmation, repeated/concurrent execution, interrupted finalization, atomic audit/provenance and persisted Style-image storage/recovery.

After separately authorized deployment:

1. Confirm ADMIN/MERCHANDISER see Season/Size import actions and ACCOUNTANT sees HSN import only.
2. Download each template; verify header names, text HSN codes and Style picture instructions.
3. Use disposable smoke records: preview and import one valid record plus one invalid row for each new kind. Verify outcomes, history, audit and downloaded exceptions; repeat and verify no duplicates.
4. Verify Season NULL serial warnings, multi-year identity, Size metadata conflicts, HSN leading zeroes and rejected GST columns.
5. Import a synthetic selected-sheet workbook with anchored PNG, Picture-in-Cell PNG and mislabeled JPEG. Verify row associations, counts, PNG serving/preview/download/PDF and repeat behavior.
6. Verify ACCOUNTANT cannot access any non-HSN shared import endpoint and MERCHANDISER cannot assign GST rules.
7. Exercise the existing Factory, Distributor, Retail Store and Style preview/confirmation workflows before authorizing the customer UAT reset.

No deployment, production data mutation, uploaded-image mutation, backup cleanup, generic development seed or historical Job Order import is part of this feature branch.
