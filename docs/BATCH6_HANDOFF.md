# Batch 6 implementation record

Approved scope: USR-001, USR-002, AUTH-LOGIN-001, ERVE-026, ISS-005, ISS-002.
One branch and PR; no merge, deployment, permission expansion, schema changes or shared database writes.

Base: bcb34fdb797808192bb18bea22951cc31673f406.

## Plan and interfaces

1. User mapping guards, reassignment confirmation in both entry points, rendered login verification.
2. Send-specific error feedback and production action eligibility parity.
3. Protected image regression evidence, browser acceptance, cross-feature checks and final review.

Shared interfaces: reassignment reuses ADMIN GET /users/:id and existing atomic POST /users/:id/factories; no API contract changes. Job Order action helpers consume existing stage/quality metadata. Send feedback consumes the established error envelope and never changes prerequisites.

Ruling: use a new sibling worktree at C:/Users/kalay/workspace/erve-batch6 to leave every existing worktree and its ignore configuration untouched; approved isolated branch based on current origin/main.

## Verification

Pending; execution results will be recorded here before handoff. Synthetic acceptance is not customer UAT.

Stage 1: API suite 55/55 passed; additional rejected-reassignment test 1/1 passed (55 deselected). Frontend mapping/login/return-path checks 25/25 passed across 4 files with maxWorkers=1. Web typecheck passed. RED reproduced inactive/suspended mapping 200 responses and missing confirmation dialogs. Initial cold PDF import timed out in an existing test; sequential rerun passed without changing its deadline. New rendered label assertions account for existing required-field markers.

