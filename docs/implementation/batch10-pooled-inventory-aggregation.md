# Batch 10 PR 1: pooled inventory aggregation (PAG-P1-08)

Baseline: `10191be2b9aa0c1a97d092ed35e4df524c825d64`. Measured 25 October 2026.

## Change and preserved contract

`getPooledFactoryInventory` previously loaded every matching QA release with
related metadata, constructed release-ID arrays for allocation queries, and
grouped results in Node.js. It now uses parameterized `Prisma.sql`:

1. Select matching releases through `QaReleaseLine.jobOrderLineSizeId` and
   Job Order lineage, applying Factory, Style, Size, current Style Season and
   Job Order record-origin filters.
2. Independently aggregate released quantities and ACTIVE commitments at
   Factory + Style + Size. Own-order ACTIVE commitments are conditionally
   summed within the commitment aggregate.
3. Join the aggregates and scalar display metadata. Compute availability as
   released minus committed plus own commitment. Convert bigint totals only
   when they are safe JavaScript integers; otherwise fail explicitly.
4. Batch primary-image resolution for distinct output Styles through the
   existing `stylePrimaryImageInclude` / `toPrimaryImageView` helpers.

Raw release quantities are never summed after joining multiple allocations.
No historical release-ID list crosses the Node/database boundary. The public
function signature and complete array DTO remain unchanged. Exhausted,
inactive, zero and negative pools remain present; `committedQuantity` always
reports the full ACTIVE commitment. RELEASED allocations are excluded, and
dispatched stock is not subtracted again.

Authorization and `assertExcludableDispatchOrder` semantics are unchanged:
ordinary reads allow ADMIN/MERCHANDISER/SENIOR_MANAGEMENT; exclusion requires
ADMIN/MERCHANDISER, an explicit matching Factory, an existing order, and no
READY_FOR_ERVE Factory Dispatch or Erve Dispatch. No route, permission, schema,
index, dependency, frontend or QA behavior was changed.

The consumers remain the pooled-inventory route, Dispatch Order equal-size
resolution, reports, historical-import verification and the Dispatch Order
form. `getAvailableQuantities`, `getEligibleQaReleaseLinesForPool`, reservation
ordering, advisory locks and transaction boundaries are unchanged. Quantity
totals now share one statement snapshot; image resolution remains a separate
read under the caller's existing isolation level.

Neither implementation specifies database result ordering. Parity compares
content by Factory/Style/Size, not array sequence. No ORDER BY or new ordering
contract was introduced; the Style picker already sorts its grouped options.

## Database isolation

Created a new Podman container `erve-batch10-pg`, ID
`e2daf6e5329d83791935af9336681ecfa2f24456406096ee47e7111472ee92c9`,
labelled `erve.batch=10` / `erve.purpose=disposable-inventory-tests`.
Verified its unique `127.0.0.1:55450 -> 5432` binding, fresh tmpfs PostgreSQL
storage and absence of volume mounts. Connected only to database
`erve_batch10_test`, user `batch10`, PostgreSQL 18.4. The initial database list
contained only that database and PostgreSQL's default database (besides templates).
No existing database/container was reused. Applied existing migrations with
`pnpm --filter @erve/api exec prisma migrate deploy` against this target.

All test processes set TEMP/TMP to this worktree's `.data/batch10/temp`, keeping
uploads separate from other sessions. The new worktree starts at the baseline;
Batch 9's worktree, files, databases and branch were not modified or integrated.

## Correctness and commands

The original implementation was captured before replacement as a test-only
reference in `src/test/pooled-inventory-reference.ts`. It is not imported by
production consumers. Baseline pooled tests: **22/22 passed**. Pre-fix regression
run: **25 passed / 4 expected failures** (historical materialization and three
unsafe numeric conversions).

Run from the worktree root, with the verified dedicated test connection in the
API's ignored environment file. Its DATABASE_URL points at an unused database
on the same disposable instance; TEST_DATABASE_URL names `erve_batch10_test`.
The repository test setup switches to TEST_DATABASE_URL before loading Prisma.

```powershell
$env:TEMP=(Resolve-Path .data/batch10/temp).Path
$env:TMP=$env:TEMP
pnpm --filter @erve/api test src/modules/job-orders/pooled-inventory.test.ts src/modules/job-orders/pooled-inventory-aggregation.test.ts
# 29 passed
pnpm --filter @erve/api test src/modules/sale-orders/dispatch-orders.test.ts src/modules/reports/reports.service.test.ts src/modules/historical-import/historical-import.service.test.ts src/modules/historical-import/historical-job-order-commit.service.test.ts
# 96 passed
pnpm --filter @erve/api typecheck
pnpm --filter @erve/api lint
pnpm --filter @erve/api build
git diff --check
```

All checks above passed. Full API/Web suites were not run locally and remain
for PR CI. Baseline and final tests emit an existing pg client concurrent-query
deprecation warning; this PR does not change the driver or reservation flow.

Parity covers 13 filter/exclusion combinations, all factories, multiple Job
Orders/Styles/Sizes, Season, live/import origins, primary-image metadata,
multiple ACTIVE allocations per release and RELEASED allocations. Hand-checked
values independently establish released/committed/available totals and own-only
add-back. Further cases cover inactive exhausted Sizes in the equal-split
divisor, negative availability, totals above int4 range, unsafe numeric totals,
and the historical verification consumer. Existing focused suites protect API
authorization, Factory/lock validation, allocation behavior and reporting.

## Synthetic performance evidence

The opt-in benchmark seeds 100, 1,000 and 10,000 releases into one fixed
Factory/Style/Size pool, with two ACTIVE allocations for each additional release
(up to 19,998 allocations). Both implementations read identical data, including
an edit-time exclusion comparison. Each scale is analyzed and warmed before
five timed reads per implementation. The Podman VM reports four CPUs and 2 GiB
RAM. No other test process used this database during measurement.

The table reports the final run's medians. Query counts come from Prisma SQL
events. Row counts are **top-level rows materialized by Prisma operations**;
they exclude nested metadata rows, so they are not physical wire-row counts.
Timings include the helper and parity assertion, not HTTP/authentication.

| Release rows | Old median ms | New median ms | SQL queries old/new | Top-level rows old/new |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 23.48 | 10.52 | 10 / 4 | 199 / 2 |
| 1,000 | 63.28 | 15.37 | 10 / 4 | 1,999 / 2 |
| 10,000 | 326.68 | 50.03 | 10 / 4 | 19,999 / 2 |

At 10,000 releases, median observed heap delta was 12,049,264 bytes old versus
205,528 bytes new. This is GC-sensitive before/after heap use, not peak memory
or an allocation profile. Output parity passed at every scale, with and without
own-order add-back. At 10,000 releases the totals were released 100,000,
committed 49,995, available 50,005; own-order exclusion restores availability
to 100,000 while committed stays 49,995.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` replayed both historical-volume old
queries and the new aggregate, retaining their bound parameters:

| 10,000-release query | Root rows | Planning ms | Execution ms | Shared hit/read blocks |
| --- | ---: | ---: | ---: | ---: |
| Old release selection | 10,000 | 0.274 | 3.138 | 116 / 0 |
| Old allocation GROUP BY / release-ID list | 9,999 | 65.516 | 22.460 | 383 / 0 |
| New aggregate with scalar metadata | 1 | 2.149 | 45.059 | 504 / 0 |

These plans have zero temporary blocks written. The optimization reduces
application transfer, intermediate IDs, metadata round trips and Node grouping;
it does not claim that aggregate SQL execution alone is faster. No additional
index was needed for these representative histories. Catalog cardinality and
production storage/cache behavior still require CI/UAT observation; this is
not a production benchmark or a pagination change.

Reproduce the benchmark only after independently verifying the disposable
instance. The harness also fails closed on any host/port/database mismatch:

```powershell
$env:POOLED_INVENTORY_BENCHMARK='1'
$env:POOLED_INVENTORY_BENCHMARK_OUTPUT=(Resolve-Path .data/batch10).Path
pnpm --filter @erve/api test src/modules/job-orders/pooled-inventory.performance.test.ts
# 1 passed; complete per-run measurements and JSON plans are written to
# .data/batch10/pooled-inventory-benchmark.json (ignored local artifact).
```

Independent review found no Critical/Important production defects. Its minor
observations were addressed by accurately labelling row/memory metrics,
capturing the old allocation plan, asserting the precise equal-split rejection,
and documenting unspecified array ordering. LOOKUP-10 and PAG-P1-06 remain out
of scope. No merge, deployment, CI polling or tracker updates are authorized.
