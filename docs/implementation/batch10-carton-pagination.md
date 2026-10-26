# Batch 10 PR 3 — PAG-P1-06

Base: `405835abe195a3533e19b013c0a9eabd3faec4a9` (latest fetched main, including merged PRs #171–173). Branch: `feature/batch10-pag-p1-06-carton-pagination`. Worktree: `C:\Users\kalay\workspace\erve-batch10-carton-pagination`.

Fetched main before creating the isolated worktree. Inspected existing branches/worktrees and tracked changes; no active overlapping carton-pagination work was found. Historical carton-picker work, Batch 9, and other worktrees were preserved. No migration, index, dependency upgrade, invoice workflow, PDF implementation, or deployment change is included.

## Behavior and contract

The old discovery endpoint hydrates every unclaimed, non-retired carton on a READY_FOR_ERVE Factory Dispatch and subsequently filters its lines, audit, Distributor and destination in JavaScript. Both selection screens previously downloaded that entire response and derived selected records from the visible result set.

`GET /erve-packing-lists/eligible-cartons` now opts into pagination when any of `limit`, `cursor`, or `search` is present. `ervePackingListId` remains optional. Default page size is 25; valid limits are integers 1–100. Search is trimmed, lowercased for request identity, capped at 256 characters, and rejects NUL. The SQL uses case-insensitive, parameterized literal substring matching on Carton Number, Factory Packing List Number and Dispatch Order Number; `%`, `_` and backslash are escaped.

Paginated responses use the unchanged success envelope:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pageInfo": { "limit": 25, "hasMore": true, "nextCursor": "opaque-cursor" }
  }
}
```

Each returned item retains the complete existing `EligibleErveCartonView`, including actual contents, Style/Size quantities, provenance, package details and `weight` serialized from `netWeight`. Shared `EligibleErveCartonPage` reuses `PaginatedResponse<T>`.

No pagination parameter retains the legacy array response, including when only `ervePackingListId` is supplied. Existing API regression consumers verify that contract. Repository production consumers are the two updated web screens; both now always send `limit: 25` and bounded search requests. No other repository production caller was found. Audit external integrations before retiring the legacy path in a separate change; no silent legacy cap is introduced.

## Retrieval and continuation

1. A single parameterized candidate query selects at most 201 slim rows: 200 examination slots plus one lookahead. It restricts retired/claimed status, READY dispatch, existence of packed lines, applicable destination-group Distributor, search and cursor position. `MAX(audit.cartonVersion) = carton.version` precisely retains the previous highest-version audit semantics, including future/higher historical audits.
2. Examine at most 200 candidates with the original six-field `destinationMatchKeyOf` and JavaScript trim/whitespace-collapse/uppercase behavior. SQL does not approximate address normalization. Null Distributor and null destination key independently omit their old discovery restriction; add-carton validation still rejects a legacy list without established identity.
3. Stop as soon as the page is full or the examination budget is exhausted. Fetch the existing nested projection only for selected IDs, retain their candidate order, and recheck retirement, claim, dispatch status, packed lines, highest audit, Distributor and address before mapping the response. There are no per-carton application queries.

Ordering is `createdAt ASC, id ASC`. Canonical base64url cursors carry a version, timestamp, unique ID and SHA-256 fingerprint of normalized search, target Packing List, and its resolved Distributor/destination restrictions. Invalid timestamps, malformed encodings and context mismatches return 400. The cursor is a position token, not authorization; existing access checks still apply.

Continuation advances from the **last examined** candidate, leaving fetched but unexamined candidates reachable. A full page can stop before the fetched batch ends; a budget-limited empty page still returns `hasMore: true` and a cursor. The 200 limit bounds work per request, not the number of eligible cartons users can eventually retrieve. Pagination observes live inventory, not a frozen snapshot. Final mutation endpoints remain authoritative.

## Selection and mutation safety

Both screens use one shared infinite-query hook, keyed by target list and normalized search, with cancellation signals and explicit user-driven continuation. Searches do not automatically scan unlimited batches. The shared controls distinguish loading, results, empty intermediate batches, final exhaustion and retryable errors; a failed continuation retries the same cursor.

Each screen retains a `Map<cartonId, EligibleErveCartonView>` independently of current results. Selected records, quantities, Factory/Dispatch Order counts, existing Style/Size consolidation and submitted IDs survive pagination, search changes, empty pages and errors. Every retained record has a removal control even when absent from current results. Create retains its coarse Distributor/City/State grouping and states that the backend checks the complete destination.

The Add flow uses a component keyed by route ID, separate query identities and immutable mutation variables containing the target list ID and selected IDs. Old page responses and pending additions cannot populate a different list. Add success clears submitted selection, refreshes detail and resets eligible queries to the first page; removal also refreshes discovery. Failure preserves selection and the actionable error. Add remains limited to authorized actors on OPEN lists.

The production implementations of create/add/remove/finalize, `claimCartonForPackingList` and `loadAndValidateCartonsForConsolidation` are unchanged. Their advisory locks, transactions, fresh validation, guarded claims and exactly-one claim checks remain intact. Existing concurrent-create coverage passed; new tests exercise competing additions and stale discovery followed by retired/stale/future-audit/empty/non-ready mutation attempts. Existing finalization, membership freeze, provenance and commercial snapshot regressions passed.

## Disposable database verification

Created a fresh Podman container `erve-batch10-carton-pagination-pg`, ID `9cd75fc92e8f0c107c460e01c4f91b9026c367261adfe6245876303a5485d7cb`. Independently inspected labels (`erve.batch=10`, `erve.purpose=disposable-carton-pagination-tests`), loopback-only `127.0.0.1:55452`, no persistent mounts and tmpfs `/var/lib/postgresql`. Verified `current_database() = erve_batch10_carton_pagination_test`, `current_user = cartonpagination`, PostgreSQL 18.6. Applied the 94 existing migrations; added none.

The ignored API environment uses a nonconnecting development placeholder at port 1 and this separate TEST_DATABASE_URL. API test setup validates and switches to the test connection. Test TEMP/TMP are scoped to this worktree's `.data/carton-pagination/temp`. Benchmark and browser preparation independently reject any other host/port/database/user and check database identity before fixture mutations. No shared, staging, production or Batch 9 database was connected to.

## Measured evidence

Committed raw measurements and PostgreSQL plans: [benchmark evidence](evidence/batch10-carton-pagination.json). Harness: `tools/carton-pagination/benchmark.mts`.

Synthetic volume: 12,000 cartons plus two real seed cartons, 96,000 packed lines, audit histories, two Factories/Dispatch Orders and multiple Distributor groups. Categories: 6,000 claimed, 3,000 retired, 500 missing audit, 500 stale audit, 50 future audit, 1,950 eligible. Destinations include same-city/different-address, same-address/different-Distributor and sparse matches. Each synthetic carton has eight real Size lines and up to four audit-history versions.

Timings below are real local Supertest HTTP requests through Express, including authentication and serialization. SQL events count actual statements; a test-only Prisma query extension counts actual hydrated records. Legacy executes first in this single synthetic run, so cache warming, host load and GC prevent extrapolating production speedup ratios. Summed SQL durations can exceed wall time because statements overlap. Heap/RSS deltas are noisy observations, not peak-memory measurements.

| Request                                |  HTTP ms | SQL statements | Slim fetched / examined | Full cartons hydrated | Response bytes | Heap delta bytes |
| -------------------------------------- | -------: | -------------: | ----------------------- | --------------------: | -------------: | ---------------: |
| Legacy, unrestricted                   | 2,010.31 |             17 | all legacy candidates   |                 3,000 |      4,436,960 |       50,396,936 |
| Bounded first page, unrestricted       |   172.49 |             18 | 201 / 25                |                    25 |         57,160 |        4,044,384 |
| Legacy, established destination        |   849.17 |             18 | all legacy candidates   |                 3,000 |        175,470 |       80,641,120 |
| Bounded first page, sparse destination |    61.02 |              7 | 201 / 200               |                     0 |            281 |        1,202,088 |

The unrestricted complete traversal returned **exactly the same full 1,950 projections** in 78 bounded pages. Destination traversal returned **exactly the same full 77 projections** in 10 pages, including empty intermediate pages. The harness asserts deep equality of complete sorted projections, not just counts or IDs. No request examined more than 200 candidates or hydrated more than 25 records in these runs. Stable-data no-skip tests separately cover ties, early page completion and 400 destination mismatches followed by later matches.

Early/late Carton searches returned one matching carton each (57.74/60.79 ms; 2,365/2,371 bytes); Factory Packing List and Dispatch Order searches each returned 25 bounded matches (106.71/121.12 ms). Literal `%_` found none (79.33 ms, no hydration). Metacharacter-positive behavior is tested against a real carton containing `%_\`.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` captures the legacy root, actual slim query, destination-restricted slim query and late search. The slim unrestricted query executed in 98.248 ms; sparse filtering 52.667 ms; late search 41.155 ms. See the committed JSON for planning times, buffers, row/loop counts and the legacy root measurement. The legacy root alone is cheaper than the new filtered root; its expensive nested hydration and application filtering are avoided by bounded discovery.

Database work is **not** limited to 200 rows: the unrestricted plan visits 1,950 qualifying rows, removes 4,051 at the carton index scan and probes the audit index 3,000 times before returning 201 candidates. Existing claim, dispatch/destination, line and audit indexes are used. No new index was assumed or added. Larger-history latency remains a measurement/optimization follow-up requiring separate index/migration approval if needed.

## Focused validation

All commands ran from the isolated worktree. No full API suite was run.

```powershell
pnpm --filter @erve/api test src/modules/fulfillment/eligible-carton-pagination.test.ts src/modules/fulfillment/erve-dispatch.test.ts src/modules/fulfillment/erve-dispatch.provenance.test.ts src/modules/fulfillment/erve-packing-list-commercial-snapshot.test.ts src/modules/fulfillment/erve-packing-list-style-images.test.ts
# 5 files, 63 passed before the additional focused mutation/role cases.
pnpm --filter @erve/api test src/modules/fulfillment/eligible-carton-pagination.test.ts
# 1 file, 25 passed, 0 failed. Together with the unchanged four regression files above: 70 distinct API tests passed.
pnpm --filter @erve/web test --maxWorkers=2 src/pages/fulfillment/EligibleCartonDiscovery.test.tsx src/pages/fulfillment/ErvePackingListPages.test.tsx src/pages/fulfillment/ErvePackingListDetailPage.test.tsx src/pages/fulfillment/pdf/erve-packing-list src/routes/AppRoutes.permissions.test.tsx
# 15 files, 242 passed, 0 failed.
pnpm --filter @erve/api typecheck
pnpm --filter @erve/web typecheck
pnpm --filter @erve/api lint
pnpm --filter @erve/web lint
pnpm --filter @erve/api build
pnpm --filter @erve/web build
git diff --check
git diff --cached --check
```

Final API/Web typechecks and lint each exited 0. Both diff checks passed. API/Web builds passed; Web retains existing large-chunk/plugin-timing warnings. The PostgreSQL driver emits its existing concurrent-query deprecation warning during integration fixtures. Initial red pagination runs failed against missing pagination/search behavior; corrected test assumptions included legacy-null Add returning 409, a recursively wrapped hydration spy, and remaining legacy web fixture arrays. No product behavior was relaxed to satisfy those fixtures.

Reproduce volume measurement only after setting TEST_DATABASE_URL to the independently verified disposable connection and local disposable JWT secrets:

```powershell
node --expose-gc --import ./apps/api/node_modules/tsx/dist/loader.mjs tools/carton-pagination/benchmark.mts
node tools/carton-pagination/run-acceptance.mjs
```

The benchmark resets disposable data. Serialize it, browser acceptance and destructive API suites. Browser preparation moves historical claims into separate compatible fixture lists so the active list remains small, and removes prior acceptance selections through the actual mutation for repeatable runs.

## Browser acceptance and review

Chrome 155, actual Web/API on loopback 5192/4192, dedicated disposable DB: **7/7 assertions passed**, 22 eligible-carton network requests observed including preflights, every one explicitly bounded at 25; zero runtime exceptions. Acceptance covers initial Create page size, retained cartons from different searches, exact 16-piece/two-Factory/two-Dispatch-Order summary, successful real Create, empty 200-candidate Add continuation, one injected HTTP 503 with same-cursor retry, keyboard Enter continuation, retained Add summaries on final empty search, successful real Add, selection clearing and refreshed detail. [Committed browser results](evidence/batch10-carton-pagination-browser.json).

Screenshots, browser session and server logs: `C:\Users\kalay\AppData\Local\Temp\erve-carton-pagination-browser-YlCfc4`. An initial browser attempt passed Create then timed out rendering the oversized historical fixture list; the fixture was corrected and the complete serialized rerun passed.

Fresh independent whole-branch review found no Critical/Important correctness or security defect. Minor evidence concerns about inferred hydration counts, service-only timing and weak UI summary/loading assertions were addressed with instrumentation, real HTTP measurement, targeted assertions and real browser checks.

Manual review before merge: independently inspect CI, check representative real addresses and role visibility, and assess the documented live-inventory/legacy compatibility and database-scan limitations. Mobile browser acceptance and production-scale latency were not measured. No remaining implementation blocker is known. CI polling, merge, deployment and tracker updates are outside this task and were not performed.

## Changed files

- API: `erve-dispatch.service.ts`, `erve-dispatch.validation.ts`, new `eligible-carton-pagination.ts` and its integration tests.
- Shared type: `packages/types/src/operations.ts`.
- Web: Create and Detail pages, their existing two test files, new `use-eligible-erve-cartons.ts`, `EligibleCartonDiscoveryControls.tsx`, `EligibleCartonDiscovery.test.tsx`.
- Evidence/reproduction: three `tools/carton-pagination` harnesses, this report, two JSON evidence files, and the implementation plan.
