# Bounded eligible-carton retrieval implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved Batch 10 PR 3, PAG-P1-06, through focused verification and PR creation.

**Architecture:** Select at most 200 slim candidates per request in createdAt/id order using parameterized SQL. Apply the existing JavaScript destination key to examined candidates, hydrate only selected matches, recheck eligibility, and continue from the last examined position. Both screens retain selected records independently of paginated search results.

**Tech Stack:** Existing Prisma/PostgreSQL, Express/Zod, React/TanStack Query, Vitest.

**Spec:** User-supplied Phase B specification, “ERVE INDIA — BATCH 10 / PR 3 — PAG-P1-06”. The approved design and constraints are summarized below; the full original is retained in the session attachment.

## Global Constraints

- Base: latest origin/main, verified 405835abe195a3533e19b013c0a9eabd3faec4a9. Preserve other worktrees.
- No new business rules, schema migration, index, dependency upgrade, unrelated redesign, merge or deployment.
- Default limit 25, maximum 100; any search/limit/cursor opts into pagination. No pagination parameters retains the legacy array contract.
- Audit eligibility means highest cartonVersion equals carton.version, not any matching audit.
- Distributor identity comes from destination.saleOrderDistributor.distributorId.
- Destination matching uses existing trim/whitespace-collapse/uppercase JavaScript unchanged; legacy null fields retain existing discovery behavior.
- Mutations retain advisory locks, transactions, fresh validation, guarded claims and finalization checks.
- Tests mutate only a newly created, independently verified disposable database. Run focused suites only.
- Stop after commit, push and one PR against main; do not poll CI.

## Review Focus

- Empty intermediate pages must provide an actionable continuation and preserve selections.
- Fetched but unexamined candidates must remain reachable when a result fills early.
- Equal timestamps and claims between requests must not cause skipped records.
- Search metacharacters are literal and search occurs before paging.
- In-place detail navigation must isolate requests, selections and mutation targets by list identity.

### Task 1: API contract and bounded retrieval

**Files:** fulfillment/erve-dispatch.service.ts, erve-dispatch.validation.ts, new eligible-carton pagination helper and tests, packages/types/src/operations.ts.

**Interfaces:** GET accepts optional ervePackingListId/search/limit/cursor; paginated data is `{items: EligibleErveCartonView[], pageInfo: {limit, hasMore, nextCursor}}` using existing PageInfo conventions.

- [x] Add integration tests for limits, cursor validation/context, search identifiers/case/literal wildcards, ordering, full-page early stop, sparse/empty/200+ candidate continuation and exact projection parity.
- [x] Run new tests and observe expected failures; preserve existing mutation regression coverage.
- [x] Implement bounded SQL candidate filtering, context-bound opaque cursor, exact destination filtering and returned-ID hydration/revalidation without N+1 queries.
- [x] Run focused API suites including eligibility, consolidation, concurrency, provenance and snapshots; expect all pass.

### Task 2: Paginated web discovery and retained selection

**Files:** new use-eligible-erve-cartons.ts and discovery controls, ErvePackingListCreatePage.tsx, ErvePackingListDetailPage.tsx and focused tests.

**Interfaces:** Consume Task 1 paginated type; shared hook includes normalized search and target list in query identity, explicit continuation, no automatic unlimited scan.

- [x] Add failing UI tests for bounded requests, pagination/search/retry, empty continuation, retained summaries and payloads, failure preservation, successful invalidation and detail identity changes.
- [x] Implement search/continuation states and record maps. Keep summaries and removal available outside visible results; preserve Style/Size grouping and coarse create grouping.
- [x] Bind detail component identity to route ID and submit immutable mutation variables.
- [x] Run focused web suites and relevant packing-list/PDF presentation regressions; expect all pass.

### Task 3: Evidence, review and delivery

**Files:** tools/carton-pagination benchmark/browser harnesses and docs/implementation/batch10-carton-pagination.md.

**Interfaces:** Exercise real API/query code on verified disposable data; report measured old/new parity, candidates, hydration, query counts, response bytes, latency, memory and query plans.

- [x] Verify container ID, loopback port, database/user and disposable storage before migration or test mutation.
- [x] Run synthetic old/new parity and benchmark cases including historical/claimed/retired/audit/sparse/search fixtures; save measurements and plans.
- [x] Run API/Web typechecks, lint, builds, focused tests and diff check. Record exact commands and counts.
- [x] Perform isolated browser acceptance if supported, then request fresh whole-branch review and address important defects.
- [x] Review final diff, commit, push feature branch, create one PR with required evidence; report base/head/URL and stop.

## Execution decisions

The user explicitly approves implementation through PR creation. Design and plan confirmation gates are already satisfied by that instruction. Execute in this session with a fresh independent final reviewer. No additional approval is needed for reversible implementation and disposable test setup.
