# A5: Post-Dispatch Reconciliation

Base: `673d729e347a26887672d0996615bf88c6db524b` (`origin/main`, fetched and verified).
Branch: `feat/post-dispatch-reconciliation`.

The workspace is `/fulfillment/erve-dispatches/reconciliation`. Each queue card opens the Reconciliation tab of the existing Dispatch detail page. Filters and pagination run in PostgreSQL; counts and rows share a repeatable-read transaction. Detail reads also use a consistent transaction snapshot.

## Evidence and classifications

Dispatch quantities come from non-retired carton lines in the finalized Packing List. Receipt and ledger comparison uses Sale Order line identity before grouping by Style × Size, preserving source order and OUTRIGHT / SALE_RETURN identity. Difference means Distributor Received minus Ledger in Use. Missing quantities display as **Not recorded**, separately from zero.

Independent indicators are awaiting distributor receipt, receipt matches ledger, receipt differs from ledger (A4 EVIDENCE_ONLY_EXISTING with a source-line difference), distributor shortage, final nothing received, QR delivery incomplete, and downstream activity exists. Shortage or discrepancy additionally flags **Follow-up required**. Opposite source-line differences cannot cancel the discrepancy classification.

QR evidence establishes physical carton delivery only. It neither establishes accepted quantities nor a shortage. A4 APPLIED uses its existing received ledger; EVIDENCE_ONLY_EXISTING retains the earlier ledger; NOT_APPLIED_ZERO remains final evidence with no ledger applied. Legacy assumed-full receipt is explicitly labeled an assumption. Downstream availability uses the existing shared quantity helpers and the current ledger.

## Reviews and safety

Detected discrepancies remain detected after review. **Acknowledged**, **Operational follow-up**, and **Finance review** record an actor, time, mandatory reason, source quantities and a full observed comparison snapshot. They are append-only, with a PostgreSQL UPDATE/DELETE rejection trigger. No generic resolved state exists.

A review sends the observed snapshot token and previous review ID. The service serializes against receipt confirmation, checks both references and appends the review plus audit event transactionally. Concurrent or stale submissions receive HTTP 409. The snapshot token includes source lines, ledger, receipt, QR evidence, sales, returns and reservations, so new activity makes old reviews pending again. Remarks survive failed refreshes.

**Actual corrections are outside A5.** Reviews never update Dispatch status, confirmation source or version, A3/A4 evidence, delivery quantities, stock, reservations, Actual Sales, Returns, returned lots, invoices, tax documents or E-Way Bills. There is no A5 business-decision blocker. Any future commercial, financial or stock correction requires a separately approved workflow and policy.

## Authorization and endpoints

| Role                                               | View                               | Review actions                |
| -------------------------------------------------- | ---------------------------------- | ----------------------------- |
| ADMIN / MERCHANDISER                               | Yes                                | All three operational actions |
| ACCOUNTANT                                         | Yes, including downstream exposure | Finance review only           |
| SENIOR_MANAGEMENT                                  | Yes                                | None                          |
| DISTRIBUTOR / FACTORY_USER / TRANSPORTER / QA_USER | No                                 | None                          |

Role gates exist at API and service boundaries. External-role combinations cannot access reconciliation through an additional internal role. Distributor A4 detail remains separate and excludes internal notes. Existing A2/A3 permissions are unchanged.

- `GET /post-dispatch-reconciliation`
- `GET /erve-dispatches/:id/reconciliation`
- `POST /erve-dispatches/:id/reconciliation/reviews`

Queue parameters: `page`, `pageSize` (maximum 100), `distributorId`, `dispatchReference`, and optional boolean strings `discrepancy`, `shortage`, `allZero`, `awaitingReceipt`, `pendingReview`.

## Persistence

One additive migration: `20261106000000_post_dispatch_reconciliation`. It creates `ReconciliationReviewAction`, `erve_dispatch_reconciliation_reviews`, foreign keys, history/previous-review indexes, remarks validation, and an append-only trigger. It contains no updates to existing business tables. Shared test cleanup truncates only the new audit table before existing guarded disposable resets.

Fresh migrations were replayed on a dedicated temporary PostgreSQL 16 cluster with separate `a5_test` and `a5_browser_test` databases. No shared database was reset or migrated. Prisma schema comparison found no A5 drift; an existing Tax Invoice line index-name difference is deliberately unchanged.

## Verification

- Focused A1–A4/A5 API regression: 73 tests across seven files passed.
- Final A5 query/comparison rerun: 22 tests across two files passed.
- Web reconciliation, existing receipt/detail and route-permissions checks: 168 tests across four files passed.
- API, web, shared and types typechecks; ESLint for affected files; `git diff --check`.
- Browser queue and detail checks at 1440px and 375px: no page overflow, no editable quantity cells, evidence/follow-up visible; review save verified through the real API.
- Independent code review: queue receipt-line scan restricted to the current receipt; failed-refresh remarks preservation added with a failing-then-passing regression. Self-review added a final-zero/no-ledger classification regression.

Browser evidence: `C:/Users/kalay/AppData/Local/Temp/erve-a5-browser-QGY0CU`. It contains viewport screenshots and `results.json`. Reproduce with `TEST_DATABASE_URL` pointing to a dedicated local `a5_browser_test`, a different `DATABASE_URL` guard, and `node tools/post-dispatch-reconciliation/browser.mjs`. The fixture script rejects other database names before resetting anything. Do not use a shared database.

## Changed-file map

- `apps/api/prisma/schema.prisma` and the one migration: persistent review history only.
- `apps/api/src/modules/fulfillment/reconciliation-{comparison,query}.ts`: source-line comparison and server-side queue calculations.
- `apps/api/src/modules/fulfillment/post-dispatch-reconciliation.{service,routes}.ts`: transactional details, RBAC and audited follow-up.
- API comparison/integration tests plus `apps/api/src/test/helpers.ts`: focused scenarios and disposable cleanup.
- `apps/api/src/app.ts`: mount the three endpoints.
- `packages/types/src/post-dispatch-reconciliation.ts`, types index and `packages/shared/src/rbac.ts`: shared contracts and role rules.
- `PostDispatchReconciliationPage.tsx`, `DispatchReconciliationTab.tsx`, `ReconciliationIndicators.tsx` and UI tests: queue, detail comparison, source breakdown, history and review entry.
- Existing `ErveDispatchDetailPage.tsx`, `AppLayout.tsx` and `AppRoutes.tsx`: tab/navigation integration.
- `tools/post-dispatch-reconciliation/`: guarded browser fixture and reproducible responsive checks.
- This handoff and the implementation plan: scope, verification and decision record.

The worktree is retained for review. Handoff stops after PR creation: no CI inspection, merge, deployment, tracker changes or A6/A7 work.
