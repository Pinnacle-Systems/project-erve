# Batch 10 PR 2 — LOOKUP-10

Final base: `5f4e5bdee7bad519840185b8131cbdd9b5907805`, containing merged PRs #171 and #170. Initial verified base was `4963df9e8dedee335be68c1a645652573e8c226c`. Worktree: `C:\Users\kalay\workspace\erve-batch10-lookup10`; branch: `feature/batch10-lookup10-bounded-style-discovery`. Batch 9 PR #170 merged during implementation. The branch was rebased cleanly onto the updated main; the only shared file was `operations.ts`, with changes in separate sections. Batch 9's worktree, branch, QA files and databases were preserved; the final PR diff contains no Batch 9 changes.

## Root cause and API

The Dispatch Order form previously fetched every Factory pool row and grouped/filtered Styles in the browser. It now discovers Styles through `GET /job-orders/pooled-inventory/style-options` and fetches complete inventory only for distinct selected Style IDs.

Query parameters: required `factoryId`; optional trimmed `search` (maximum 200 characters, raw input capped at 1,000), `excludeSaleOrderId`, `limit` (default 20, integer 1–100), and opaque `cursor` (maximum 4,096 characters). IDs follow the repository's ULID convention, replacing the illustrative UUIDs in the proposed contract. Invalid parameters/cursors return 400 through the standard error envelope.

Example standard success-envelope data:

```json
{
  "items": [{
    "styleId": "01K00000000000000000000001",
    "styleNumber": "STYLE-001",
    "styleName": "Example Style",
    "lmixNumber": "LMIX-001",
    "primaryImage": null
  }],
  "pageInfo": { "limit": 20, "hasMore": true, "nextCursor": "opaque-cursor" }
}
```

Only Style identity, LMIX and existing primary-image metadata are exposed. No release/allocation IDs or Factory/source provenance are included. Image content continues through the existing authenticated endpoints.

## SQL and pagination

The focused SQL statement mirrors PR #171's authoritative arithmetic: select Factory/search-matching releases through Job Order lineage, independently sum released and ACTIVE committed quantities per Style/Size, and compute `released - committed + own_ACTIVE_commitment`. A Style is eligible if any Size has positive effective availability. Historical/inactive Styles remain eligible, RELEASED commitments do not subtract stock, and dispatched quantities are not subtracted again.

Search is a case-insensitive literal substring of Style Number, LMIX or Style Name. LIKE metacharacters are escaped and all user values are bound with `Prisma.sql`. Positive-stock eligibility precedes the `Style Number ASC, Style ID ASC` keyset predicate and `limit + 1`. Node receives at most that many scalar Style candidates, trims only the continuation sentinel, and batches existing primary/fallback image hydration for returned IDs only. No historical release-ID list, complete Factory pool, or per-Style inventory query is used for discovery.

The versioned base64url JSON cursor validates its encoding/shape and binds the last ordered key to Factory, normalized search and excluded order. Malformed/mismatched contexts fail explicitly. Page size can change between pages without changing the result order. This is a live inventory view, not a snapshot: concurrent stock changes can add/remove candidates between requests. Final allocation always revalidates current stock and the equal-size split.

Ordinary access remains ADMIN/MERCHANDISER/SENIOR_MANAGEMENT. Exclusion calls the existing `assertExcludableDispatchOrder` and therefore requires ADMIN/MERCHANDISER, an explicit matching Factory, an existing Dispatch Order and the existing unlocked-order checks. View-only callers cannot add back commitments.

## Frontend and selected inventory

The focused infinite-query hook debounces search by 300 ms, resets pagination with the search/context key, passes abort signals, combines pages without duplicate IDs, and uses no previous-context placeholder data. Requests begin when the lookup opens. Factory/exclusion changes remount the discovery field, cancel the old observer and reset its search/panel.

LookupField gains optional panel actions and an opt-in flag to retain its panel while an option-hosted preview dialog receives focus. Load more appends pages; errors expose retry. Tab/Shift+Tab traverse continuation controls while preserving the textbox/form order, Escape returns focus, and removing a focused final-page/retry control restores the textbox. The preview flag prevents an authenticated image viewer from being unmounted when it takes focus from the Style textbox. Other lookups retain their existing hook and default behavior.

Distinct selected Styles use TanStack queries keyed by Factory, Style and applicable excluded order, calling the existing `/job-orders/pooled-inventory` with **both** Factory and Style. Multiple destinations share that hydration. `/styles/:id` still supplies configured active Sizes; the preview unions them with all pooled Sizes, including exhausted historical Sizes. Confirmed absent stock and loading failure are distinct: pending reads show loading, failures show unconfirmed quantities and retry, and incomplete data does not render a false zero-stock preview.

Selected values remain in draft state independently of discovery pages and preserve saved identity/image fallback. Factory switching retains quantities/destinations and unrelated fields, refreshes stock in the new context, and applies edit-time own-order exclusion only at `originalFactoryId`. No backend Size resolution, equal split, allocation ordering, reservation or stock validation code changed.

## Disposable environment

Created a fresh container `erve-batch10-lookup10-pg`, ID `01219d75bc44e976cde8d3f7353d252900f38cb0a34fa92b8804545e98879c79`, labels `erve.batch=10` and `erve.purpose=disposable-lookup10-tests`, bound only to `127.0.0.1:55451`. Verified no persistent volume mounts, tmpfs storage, database `erve_batch10_lookup10_test`, user `lookup10`, PostgreSQL 18.6. Applied the 94 existing migrations; no new migration/index/dependency was added. All API tests used isolated TEMP/TMP under this worktree's `.data/lookup10/temp`.

## Validation

Commands run from the worktree root. API test setup reads the ignored local API environment and switches to its separately verified TEST_DATABASE_URL.

```powershell
$env:TEMP=(Resolve-Path .data/lookup10/temp).Path
$env:TMP=$env:TEMP
pnpm --filter @erve/api test src/modules/job-orders/pooled-style-options.test.ts src/modules/job-orders/pooled-inventory.test.ts src/modules/job-orders/pooled-inventory-aggregation.test.ts src/modules/sale-orders/dispatch-orders.test.ts
# 113 passed, 1 opt-in benchmark skipped
pnpm --filter @erve/web test src/pages/sale-orders/SaleOrderFormPage.test.tsx src/pages/sale-orders/DispatchOrderStyleField.test.tsx src/lib/use-server-lookup.test.tsx
# 34 passed
pnpm --filter @erve/design-system-tests test src/lookup-field.test.tsx
# 25 passed
pnpm --filter @erve/api typecheck
pnpm --filter @erve/web typecheck
pnpm --filter @erve/api lint
pnpm --filter @erve/web lint
pnpm --filter @erve/api build
pnpm --filter @erve/web build
pnpm --filter @erve/primitives --filter @erve/design-system-tests typecheck
pnpm --filter @erve/primitives --filter @erve/design-system-tests lint
git diff --check
```

Baseline checks passed: 22 pooled-inventory tests and 14 form tests. Shared lint reports three pre-existing date-picker hook warnings; API tests emit the existing pg concurrent-query deprecation warning. Web build retains its existing large-chunk/plugin-timing notices. Full API/web suites and PR CI were not run/polled locally.

Independent local review found two Important keyboard issues (portalled Tab order and focus after final continuation/retry). Both were reproduced in failing tests and fixed. Final self-review strengthened the thumbnail regression to focus the textbox first, reproduced premature viewer unmount, and fixed it through the opt-in primitive flag. The web regressions and 25-test primitive suite passed; the primitive suite protects both opted-in preview behavior and unchanged defaults. No remaining review findings were deferred.

The final-base combined API rerun passed the three existing suites (83 tests), but discovery's volume fixture hit its original 120-second setup timeout under concurrent build load before assertions ran. The fixture timeout was raised to 300 seconds and discovery rerun independently with `pnpm --filter @erve/api test src/modules/job-orders/pooled-style-options.test.ts`: **30 passed, 1 opt-in benchmark skipped**. API/business rules were unchanged. The full pre-integration four-file run had already passed 113 tests. Final-base typecheck/lint/build and browser/web/primitive checks were repeated after integration.

Browser acceptance uses real Chrome, the web app and API on dedicated loopback ports 5191/4191, and only the independently verified disposable database. It covers 20 initial options, append to 29 distinct eligible options, keyboard continuation/Shift+Tab/final-page focus, independent selected hydration, a fully committed saved Style, two saved Styles, edit-time own-order add-back and retained draft quantity while switching away from/back to the original Factory. Network assertions check that every pool request contains a Style ID and new-Factory requests omit exclusion. Six explicit browser assertions plus request/data checks passed, with zero browser runtime/console errors.

```powershell
# Set TEST_DATABASE_URL to the independently verified disposable connection.
node tools/lookup10/run-acceptance.mjs
```

For browser acceptance without running the volume benchmark, generate the same 29-option/two-Factory browser scenario with `tools/lookup10/seed-browser.mts` first. Set DATABASE_URL to the verified disposable connection and provide the local disposable JWT configuration, then run `node apps/api/node_modules/tsx/dist/cli.mjs tools/lookup10/seed-browser.mts` from the repository root. Run browser acceptance only after destructive API suites have finished; they intentionally reset the same disposable database.

The browser fixture setup is restricted to the exact disposable target. On repeat runs it removes only its own synthetic actor's previous `Browser test` orders, after rejecting any dispatched order, so its fully committed Styles can be exercised again. It preserves benchmark/other fixture orders. The harness accepts the existing unsaved-changes warning when navigating between scenarios; no production warning behavior changed. Browser render counts are measured; CPU render profiling was not performed.

Final serialized browser command exited 0 on the final main base, with **6/6 assertions passed** and no console/runtime errors. Evidence, screenshots and request outcomes are at `C:\Users\kalay\AppData\Local\Temp\erve-lookup10-browser-uBHui5`. Final-base focused API checks total **113 passed** across the three existing suites and the isolated discovery rerun; the opt-in benchmark is skipped in ordinary runs. Web checks passed **34/34**, primitive checks **25/25**. One extra browser rerun overlapped an API database reset and failed synthetic login; the recorded final run was serialized after all destructive suites and passed.

## Performance evidence

The opt-in harness combines 135 Styles, multiple Sizes/Factories, 105 consumed candidates before sparse live matches, mixed per-Size availability, primary/fallback images, multiple saved Style lines and increasing release histories. Each additional historical release is fully consumed by two partial ACTIVE commitments. It measures five warmed service reads per search and records SQL events, bytes/records, full EXPLAIN ANALYZE/BUFFERS JSON and selected-Style hydration. These are synthetic local measurements, not production throughput or a browser rendering benchmark.

```powershell
$env:LOOKUP10_BENCHMARK='1'
$env:LOOKUP10_BENCHMARK_OUTPUT=(Resolve-Path .data/lookup10).Path
pnpm --filter @erve/api test src/modules/job-orders/pooled-style-options.test.ts
```

Raw artifact: `.data/lookup10/lookup10-benchmark.json` (ignored). The harness fails closed on any hostname/port/database mismatch. Its initial fixture run failed the existing physical batch quantity invariant; the fixture was corrected to match the source batch quantity without altering schema or business logic.

The final benchmark run passed **31/31 tests**, including all discovery regressions and the opt-in measurement. It was measured before the final main rebase; the discovery/aggregation SQL is unchanged by that integration. Each cell below is a median of five warmed service calls; bytes include the synthetic standard success envelope. Measurements exclude HTTP/authentication. Additional historical releases are above 138 fixture release lines; there are 135 distinct Styles and 20,107 ACTIVE allocations at the largest scale.

| Additional consumed releases | Empty search ms | Early `LIVE-0` ms | Late `LIVE-3` ms | SQL queries per call |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 10.69 | 9.54 | 9.58 | 4 |
| 1,000 | 12.67 | 9.15 | 9.40 | 4 |
| 10,000 | 32.27 | 6.92 | 8.55 | 4 |

At all scales, empty search returned exactly 2 records / 568 bytes. The targeted searches returned 1 record / 228 bytes (without image) and 507 bytes (with existing image metadata). Query count stayed at four for each page and each selected-Style hydration; no per-Style/image N+1 behavior appeared. The SQL statement returned at most three candidates for limit two, including its single continuation sentinel.

| 10,000-release discovery plan | Planning ms | Execution ms | Root rows | Shared hit/read blocks |
| --- | ---: | ---: | ---: | ---: |
| Empty search | 1.870 | 32.328 | 3 | 520 / 0 |
| `LIVE-0` | 1.819 | 1.565 | 1 | 157 / 0 |
| `LIVE-3` | 1.725 | 2.454 | 1 | 458 / 0 |

The empty-search plan examined 10,138 release rows in PostgreSQL and materialized 10,137 matching releases inside its database CTE, while only three Style candidates reached Node. It scanned 20,107 ACTIVE allocation rows (one RELEASED row was filtered out). Targeted searches restricted the release CTE to one or three rows; existing allocation indexes were used at the largest scale. Full scan/node/loop counts and buffers are retained in the JSON plan artifact. These figures describe database work; the endpoint does not promise constant-time empty-search SQL as history grows.

Selected-Style hydration returned both complete Size rows, including the negative/exhausted historical Size, in **11.66 / 9.92 / 11.90 ms** for the three scales (one measured read per scale), four queries and 1,386 bytes. Expected availability `[-21, 10]` was asserted at each scale. This demonstrates bounded transfer and accurate selected hydration; no unmeasured comparison to the prior UI's latency or browser CPU is claimed.

## Limits and acceptance

Inventory can change between pages or selection and save; current backend allocation validation remains authoritative. Discovery eligibility means some Size has stock, not that every requested equal split can be allocated. Production cardinality/storage/cache behavior, end-to-end create/edit saves with representative business data, and assistive-technology acceptance still require UAT. Comprehensive regressions remain for PR CI. No merge, deployment, review request, consolidated tracker update, Batch 9 work or PAG-P1-06 is part of this change.

## Changed files

- `apps/api/src/modules/job-orders/job-orders.routes.ts`
- `apps/api/src/modules/job-orders/pooled-style-options.service.ts`
- `apps/api/src/modules/job-orders/pooled-style-options.test.ts`
- `apps/web/src/lib/use-paginated-server-lookup.ts`
- `apps/web/src/pages/sale-orders/DispatchOrderStyleField.tsx`
- `apps/web/src/pages/sale-orders/DispatchOrderStyleField.test.tsx`
- `apps/web/src/pages/sale-orders/SaleOrderFormPage.tsx`
- `apps/web/src/pages/sale-orders/SaleOrderFormPage.test.tsx`
- `packages/primitives/src/components/lookup-field.tsx`
- `packages/design-system-tests/src/lookup-field.test.tsx`
- `packages/types/src/operations.ts`
- `tools/lookup10/prepare-browser.mts`
- `tools/lookup10/seed-browser.mts`
- `tools/lookup10/run-acceptance.mjs`
- `docs/implementation/batch10-lookup10.md`
- `docs/superpowers/plans/2026-10-25-lookup10.md`
