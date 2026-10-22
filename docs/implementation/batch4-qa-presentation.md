# Batch 4: QA forms and PDF presentation

Baseline: `92431c1df10694b6cbe489626aa261e077975ac9` (includes merged Batch 3 PR #151).
Branch: `batch4/qa-presentation-pdf-20261022`.

## Issue dispositions

All five issues started Open. The first four are closure candidates after final-head CI; the PR close-out records the actual head, checks and merge result.

| Issue | Root cause and delivered behavior | Proposed disposition |
| --- | --- | --- |
| ISS-042 | Job Order PDF coverage combined piece quantities with batch counts without units. Prepared/Inspected now explicitly use pcs; passed/failed explicitly use Batches. Authoritative physical coverage selection and all quantities remain unchanged. | Closed after final-head checks |
| ISS-045 | PP Sample and historical QA detail printed an unrelated inventory message; the PP PDF view model also built it. Removed the web panel, PDF section, property and obsolete expectation. | Closed after final-head checks |
| ISS-046 | Execution page and form each rendered a title, with large duplicate system identity panels. Web forms opt into one compact PageHeader-based identity; PP retains its own cycle/sample structure. Factory, quantity and recorded Season use the existing authorized Job Order read when absent from canonical form definitions. Export waits while that read is pending. Mobile consumers retain their previous default. | Closed after final-head checks |
| ISS-047 | Definition-driven renderers printed system Customer/PO/Merchandiser and historical EIOS fields. A shared presentation projection filters component/source/sourceKey/system-key metadata, retaining USER fields and unmodified responses. Both draft/finalized UI and exported PDFs use it. | Closed after final-head checks |
| ISS-044 | Reproduced orphan context headings, split conclusion/sign-off, clipped long PP form and EIPL totals alone. Bounded flow/keep rules correct those defects. A page-aware repeated-column-header gap remains in EIPL matrices; see complexity gate below. | Deferred, partial fixes delivered |

## Changed implementation

- `apps/web/src/pages/job-orders/pdf/buildJobOrderDetailViewModel.ts`: unit labels only; list PDF unchanged.
- `apps/web/src/pages/qa/{QaDetailPage,QaInspectionForm,QualityExecutionPage}.tsx`: compact identity, duplicate-context reduction, obsolete availability removal, authorized existing read for missing identity.
- `packages/app-components/src/quality-presentation.ts` and execution form/shell: pure source-aware projection and opt-in web identity. No stored definitions or response arrays are changed.
- QA PDF view models/documents/shared block rendering: provenance suppression, compact PP identity, long-form flow, bounded narrative/sign-off grouping.
- `PdfSection`: opt-in heading presence reservation, with unchanged defaults.
- `PdfStyleSizeMatrix`: opt-in EIPL boundary-row reservation; EIPL caller opts in. Existing worker, flattening, batches, quantities and global numbering remain.
- `tools/batch4`, synthetic browser entry/fixtures, PDF regressions and CI artifact steps provide reviewable acceptance.

## Field-source decisions

Consolidate system Job Order, Factory/Supplier-derived-from-Factory, Style and ordered quantity into identity. Show recorded Job Order Season snapshots, never current Style Season as a substitute. Suppress system CUSTOMER_NAME, PURCHASE_ORDER_NUMBER, MERCHANDISER_NAME and known historical Order Sheet/EIOS keys. Do not match display labels.

Preserve source USER Customer/Supplier, meeting and inspection dates, meeting conductor, attendees, signatories, remarks, sampling, measurements, production context, batch allocation/history and results. Keep system REPORT_DATE under its existing label; it is not treated as a persisted inspection date. Authorized Merchandising provenance remains in the unchanged Job Order/reporting paths.

## Executed local validation

- `pnpm --filter @erve/web test --maxWorkers=2`: 2,153 tests / 268 files passed before the final historical-detail availability regression; that final component change is separately checked and the complete final tree is verified by PR CI.
- `pnpm --filter @erve/web test src/lib/pdf/batch4-pagination.test.tsx src/pages/qa src/pages/job-orders/pdf --maxWorkers=2`: 199 tests / 19 files passed before the final historical-detail case.
- `pnpm --filter @erve/client test`: 56 tests passed.
- `pnpm --filter @erve/design-system-tests test --maxWorkers=2`: 125 tests passed.
- `pnpm --filter @erve/app-components test --maxWorkers=2`: 122 tests passed.
- `node --test tools/pr8/*.test.mjs`: 5 tests passed.
- `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r build`: passed. Existing DatePicker hook warnings and build chunk-size notices remain.
- `node tools/batch4/browser.mjs`: 16 workflow/viewport combinations, four finalized read-only cases and four actual PDF downloads passed. All 16 had one h1, no horizontal overflow, no derived provenance, accessible PDF actions and working authenticated image retrieval/viewers. Desktop headers measured 120px; mobile headers 136px (PP) and 224px (execution forms with Season).
- Independent read-only review identified the canonical Inline quantity gap and pending-context export race. Both have regression tests and fixes.

The initial unrestricted focused PDF run hit an unchanged long-list timeout under parallel load; the two-worker rerun passed. An early full run observed an in-progress Inline regression failure; the subsequent settled full run passed. No failing run is counted as acceptance.

API integration uses CI's job-scoped Postgres 18 service. No local/shared/production database was accessed. Deployment ShellCheck, actionlint and fixture checks run in CI's Linux job.

## Browser and PDF evidence

Local logs and generated PDF/PNG/position JSON files: `C:/Users/kalay/workspace/batch4-evidence-20261022/`.
Browser evidence: `C:/Users/kalay/AppData/Local/Temp/erve-batch4-browser-1QZW5E/` (screenshots, measurements, actual downloads).
The PR CI publishes `batch4-browser-<head>` and `batch4-pdfs-<head>` artifacts for remote review; artifacts retain 14 days.

Fixtures verify 72 pieces/two passed batches, 12,500 pieces with three passed/one failed batches, zero/missing prepared quantity, authoritative coverage versus repeated attempts, single/consolidated customer contexts, authored fields and finalized executions. Existing Job Order PDF tests preserve authorized provenance.

Pagination fixtures cover short PP (now one page), 60 checkpoints (three pages, every checkpoint exactly once and within body margins), two cycles x two forms x 12 rows/images (six pages), Final with three attempts and supported/no evidence (four/three pages), Inline conclusion and Final context headings at boundaries, 36 adjacent EIPL Style counts, and three cartons with 11 Size columns through the existing pipeline. Representative pages were rasterized with pdfjs and visually inspected. Image evidence pages are legitimate and preserved.

## ISS-044 complexity gate and remaining work

The 11-Style, three-Size EIPL fixture originally produced a final page containing only its totals. The opt-in last-row reservation now carries ST-011 with those totals. Content/quantities reconcile. However that continuation page has no repeated Style/Size column headings.

`PdfStyleSizeMatrix` repeats headers every `rowsPerHeaderRepeat` rows (default 25), not at measured page boundaries. Variable-height Style names, carton metadata, multiple Size groups and preceding identity sections make fixed row counts diverge from actual pages. The existing code explicitly avoids globally fixed group headers because those headers can repeat after their group and overlap later groups. The bounded presence rules do not create a page-aware table-header primitive.

Retain the focused corrections and passing content/boundary tests. A follow-up should add a group-scoped continuation-header primitive with measured or renderer-supported page context, qualify variable-height rows and multiple Size groups in both the worker and merged documents, and prove header/data association at every continuation boundary. Do not close ISS-044 until that remaining long-table acceptance passes. This batch does not rewrite the shared pagination engine.

## Scope and release safety

No API business logic, schema, permission rules, quantity calculations, QA decisions, workflow transitions, physical allocations, inventory release, audit persistence or historical data changed. The added Job Order request uses an existing authenticated, role-scoped GET and projects approved identity only. No production deployment is authorized or performed. Batch 3 files are preserved; Factory Packing improvements are not reimplemented.

Main had no protection/rulesets during audit. Before merge, recheck restrictions, reviews, final-head checks, complete diff and remote main. Production deployment remains manual workflow_dispatch. Do not edit the canonical tracker.
