# INV-007 — invoice workflow and issued document contract

Branch: `feature/invoice-inv007-workflow`. Implementation began on PR0 main
`5749bbe37fc434de98237a96d7133c02bf2ac495`. Style PR65 has since merged as
`2f133c767f94d9c29f2ff266b63169df5909ff0b` and is integrated. PR1 publication
is for CI and review; merge acceptance remains pending.

## Workflow

- Server cursor pagination, search/status filters and bounded eligible EIPL lookup.
- ACCOUNTANT-only creation, override with required reason, and finalization;
  ADMIN/ACCOUNTANT reads. Menu, route, action and backend roles agree.
- Backend preview shares finalization calculation preparation, without financial
  writes, EI allocation or audit writes. Production cutover readiness is checked
  without creating numbering or reference data.
- Issued financial snapshots and frozen HSN are rendered using exact decimal
  strings, including signed round-off and payable. Legacy nulls remain unavailable.
- Persisted financial history shows actor/time, original calculated rate, override,
  reason and finalization/EI. Failed overrides retain inputs; duplicate submission
  is guarded. Finalization refreshes and stops on changed review values.
  Physical quantities cannot be edited.

## Approved presentation contract

The explicit Batch 1 extension authorizes one nullable JSON field,
`TaxInvoice.documentSnapshot`. The additive migration contains no backfill.
`ERVE_TAX_INVOICE_DOCUMENT_V1` freezes per-line Style identity/description, colour,
size/quantity and archived-image descriptors, verified carton-derived Dispatch
Orders (including multiple orders), and persisted LR/transport references.
It contains no pricing, HSN, GST or payable calculation engine.

Existing finalized invoices retain null snapshots and acquire no archive files.
Reads/repeat finalization never backfill. Legacy master labels are identified as
current references. Unknown/invalid snapshot versions remain unavailable and are
protected from cleanup. The historical-reference field preserves legitimate EISO
verbatim and separately; new issuance always sets it null. No EISO mapping,
renaming or Erve Dispatch substitution is performed.

## Image consistency and recovery

1. An invoice-locked preparatory transaction validates prerequisites, captures
   source presentation, reads original image bytes under existing Style-image
   locks, and commits private File journals before any archive upload.
2. A separate invoice-locked phase uploads independent copies and verifies hashes
   and lengths. Matching copies are reused; partial local objects are repaired
   only while the invoice remains DRAFT under its lock.
3. The existing financial transaction revalidates prerequisites and presentation,
   verifies archives, and freezes document/financial snapshots, EI and audit
   atomically. Changed presentation fails closed and requires retry.

Failed upload/finalization or a crash can leave private journaled objects; they
are not published. Retry recaptures verified presentation and reuses matching
copies. Deterministic invoice/Style/checksum IDs prevent duplicate copies under
repeated/concurrent finalization. Already-finalized retries do no archival/writes.
Later Style replacement/deletion cannot alter independent archived bytes.

`GET /tax-invoices/:id/images/:imageId/content` enforces ADMIN/ACCOUNTANT in route
and service, issued snapshot membership, invoice namespace and checksum. Checks
precede ETag handling. Responses are private; no permanent public URL is exposed.
The UI reuses `useAuthedImage` and generic `ImageViewerDialog`. Style media and
shared implementations remain unchanged. INV-008 must use this authorized endpoint.

`invoice-media:reconcile` defaults to dry-run, rejects production and requires
positive Dev-target proof through the existing guard with
`INVOICE_ARCHIVE_EXPECTED_DEV_DATABASE_URL`. Use `--invoice-id <id>`; after
inspection, `--apply` removes only unreferenced objects older than 24 hours for a
finalized, recognized snapshot. Draft journals, issued images and legacy/unknown
snapshots are protected. No production cleanup job or deployment is activated.

## Verification checkpoint

Safety-verified disposable databases received the nullable migration:
`erve_inv007_test_f2765e00` and `erve_inv007_browser_test_f2765e00`.
No development/production datasets changed.

Latest coverage passes: 85 full invoice/calculation regressions, 100 focused web
tests, 2 versioned-reader tests and 6 integration cases covering multiple orders, frozen identity/size/LR, missing source
bytes, partial-upload recovery, failed-finalization retry, concurrency/idempotency,
restricted/cross-invoice media access, master-image replacement/deletion, orphan
recovery and legacy preservation. Workspace typecheck, lint and integrated build
pass. After integrating PR65, 19 affected API regressions and 119 design-system
tests passed. All 56 client regressions passed. Logs are ignored local artifacts.

The earlier bounded full web run passed 1,554 tests across 219 files but had a Style
worker-start error. Isolated reruns reproduced a Style PDF-error-state timeout on
unchanged PR0 main; the isolated case still fails after integrating PR65. Style
files were not modified. All three CI jobs on merged PR65 main are successful;
PR1 still needs its own exact-head required CI. No check is waived.

Automatic approval review rejected both normal and debugging Chrome launch,
reporting only "blocked by policy". No browser tool is exposed. The user selected
provision of a browser-enabled environment; required native maximized/100%-zoom
and responsive evidence stays pending until available.

## Delivery boundaries

No INV-007 merge/completion until acceptance, exact-head mandatory PR CI, required
reviews and integration safeguards pass. No production migration, GST activation,
EI baselining, live issuance or deployment dispatch. No cancellation, Credit Note
or Style workstream changes. INV-008 consumes the contract after verified PR1
integration; Batch 2 remains read-only planning afterward.

INV-008 must use existing frozen monetary fields and the authorized archived-image
endpoint. Future Credit Note and reporting consumers must explicitly distinguish
issued payable from the pre-round-off grand total; their calculations, ledgers and
lifecycles are not changed here.
