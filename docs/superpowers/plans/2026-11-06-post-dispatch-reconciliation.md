# Post-Dispatch Reconciliation Implementation Plan

**Goal:** Implement the supplied A5 specification as operational comparison and append-only follow-up, then open one PR and stop.
**Architecture:** Separate query/service/UI modules. Compare source Sale Order lines before Style × Size aggregation. Reuse downstream quantity helpers. Reviews contain immutable snapshots and use a snapshot token plus previous review ID for concurrency.
**Tech Stack:** Existing Express, Prisma/PostgreSQL, React Query and ERP components; no new dependencies.
**Spec:** User-provided A5 request, baseline 673d729e347a26887672d0996615bf88c6db524b.

## Global constraints

- Never mutate operational evidence, dispatch, inventory or financial records.
- Disposable PostgreSQL only; no shared database migrations or resets.
- Internal RBAC at routes and service; no distributor notes exposure.
- Stop after one PR; do not inspect CI, merge or deploy.

## Review focus

- Opposite source-line differences must not cancel within Style × Size.
- Missing evidence must remain distinct from zero, especially final zero receipt.
- QR evidence must not imply accepted quantities.
- New evidence/activity must make an earlier review pending again.
- Stale or concurrent reviews must not change Dispatch version or lose history.

### Task 1: Comparison and persistence

- [x] Add source-line comparison tests; observe failure, then implement classifications.
- [x] Add shared contracts and role helpers.
- [x] Add minimal review model and additive SQL with append-only trigger.

### Task 2: Queries, service and API

- [x] Implement SQL-filtered queue with accurate pagination/count in repeatable-read transaction.
- [x] Implement detail with frozen cartons, A3, A4, ledger and shared downstream helpers.
- [x] Implement snapshot-aware append-only reviews and enforce roles at both boundaries.
- [x] Test business scenarios, isolation, concurrency and absence of unrelated writes using disposable PostgreSQL.

### Task 3: ERP UI

- [x] Add queue navigation, filters and pagination.
- [x] Add detail tab with side-by-side quantities, source identity, history and remarks.
- [x] Verify desktop/mobile, accessibility and role behavior with focused tests/browser.

### Task 4: Handoff

- [x] Run affected typechecks/lint and A1–A4 focused regressions.
- [ ] Review diff, commit, push and create requested PR (last external handoff action).
- [x] Report SHAs, migration, evidence, classifications and correction boundary; stop.

Ruling: The user's detailed agreed scope and explicit instruction to implement without broad investigation are the design authority; no additional design approval round is needed.
