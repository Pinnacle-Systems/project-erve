# QA inspection and rework domain

## Decisions and bounded assumptions

- A mapped `QA_USER` initiates an inspection from the QA queue. Admins and merchandisers may also act for exception resolution. Senior management is read-only.
- QA scope is one factory per QA account, using the existing `user_factories` mapping. Zero mappings fail `FACTORY_MAPPING_REQUIRED`; multiple mappings fail `FACTORY_MAPPING_AMBIGUOUS`. This is deliberately fail-closed until a dedicated multi-site QA assignment model exists.
- Inspection is a partial, versioned session against job-order style/size lines. Multiple sequential sessions are allowed. A version conflict prevents two clients from consuming the same quantity.
- Draft lines reserve first-pass or rework quantity. A user can correct their own draft. Finalized sessions are immutable facts.
- Accepted quantities remain provisional until job-level `QA_APPROVED`. Only then is the derived accepted total copied to the purchase-order QA-passed counter and exposed as `finalApproved` for the future warehouse workflow.
- Defects use the controlled `QaDefectCategory` enum. Defect category is required for rework or permanent rejection; notes remain optional. Permanent rejection also requires line-linked photo evidence.
- All defect categories are rework-eligible in this slice. QA chooses rework versus permanent rejection. This policy is intentionally data-extensible; a future defect master can narrow eligibility without changing historical rows.
- A rework task is created from a finalized line, for exactly its rework quantity. Factory may acknowledge it and mark that same quantity ready. Reinspection cannot exceed the task quantity. A later reinspection may accept, rework again, or permanently reject it.
- A finalized session may be reopened only by admin or merchandiser, before job approval, and only if it did not generate rework. Reopening preserves the original session as `REOPENED`; replacement is recorded in a new session. An approved job cannot be reopened because its quantity has been released as an external contract. A future explicit downstream reversal workflow is required for that case.
- Evidence uses the existing production `FileStorage` adapter. JPEG, PNG and WebP signatures and maximum size are checked server-side. Server-generated keys and checksums avoid trusting names. Duplicate content in a session returns the existing record. Upload is a separate draft attachment action, so quantity finalization never commits while a fragile upload is in flight.
- Android draft entries are stored locally per job order until successful finalization. Submitted requests are retried with an unchanged idempotency key by the mutation retry control; server state always wins after a stale-version response. This is intentionally not a general offline-sync subsystem.

## State machine

```text
READY_FOR_QA
  -> QA_IN_PROGRESS                 start/save partial inspection
  -> REWORK_REQUIRED                finalized outcome contains rework
  -> READY_FOR_REINSPECTION         factory marks rework ready
  -> QA_IN_PROGRESS                 QA starts reinspection
  -> QA_APPROVED                    all prepared quantity reaches a terminal outcome
```

`QA_IN_PROGRESS` may contain accepted, permanent-rejected, uninspected, and draft-reserved quantities. The summary status never substitutes for line facts. A mixed accepted/permanent-rejected job closes as `QA_APPROVED` once fully reconciled; `finalApproved` includes accepted quantity only. A zero-accepted job can close with all quantity permanently rejected and exposes zero downstream-ready units.

Invalid state transitions return stable `CONFLICT`; optimistic concurrency returns `STALE_VERSION`; scope failures return stable mapping or `FORBIDDEN` errors.

## Quantity invariants

For every inspection line:

```text
inspected = accepted + rework + permanently rejected
```

All terms are non-negative. PostgreSQL `CHECK` constraints enforce both rules. Constraint triggers lock the size or rework row and enforce aggregate first-pass and reinspection capacity. The API also holds a transaction-scoped advisory lock per job order so it can return a stable conflict before a database constraint error.

First-pass finalized plus draft-reserved quantity cannot exceed prepared quantity. Reinspection cannot exceed its source rework task. Open rework must be zero before approval. Initial finalized inspection must equal prepared quantity, and terminal accepted plus permanently rejected outcomes across every cycle must also equal prepared quantity. Final approved quantity is derived on the server from finalized accepted lines.

## API contract

- `GET /qa/queue` — compact cursor-paginated queue; filters: state, factory, date range and job/PO search.
- `GET /qa/job-orders/:id` — reconciliation, sessions, evidence metadata and rework.
- `POST /qa/job-orders/:id/inspections` — start first inspection or selected reinspection.
- `PUT /qa/inspections/:id` — replace the caller's versioned draft lines.
- `POST /qa/inspections/:id/finalize` — freeze outcomes and create rework tasks transactionally.
- `POST /qa/job-orders/:id/approve` — publish authoritative final quantity.
- `POST /qa/inspections/:id/reopen` — admin/merchandiser exception action.
- `POST /qa/inspections/:id/evidence` and `GET /qa/evidence/:id/content` — authorized evidence lifecycle.
- `GET /qa/rework`, `POST /qa/rework/:id/acknowledge`, `POST /qa/rework/:id/ready` — minimum factory handoff.

Every business mutation requires `expectedVersion` and `Idempotency-Key`. Records are scoped by actor and operation and include a SHA-256 request hash. Exact replay returns current authoritative detail without a second mutation or audit event. Key reuse with another entity or payload returns `IDEMPOTENCY_KEY_REUSED`. Mutation, version, idempotency record and audit commit in one transaction.

## Explicit exclusions

No warehouse record, receipt, allocation, reservation, packing, dispatch, invoice, return, payment, notification, dashboard, Tally integration or general offline synchronization is created here. `QA_APPROVED` and `finalApproved` are the only handoff contract for the future warehouse availability and reservation slice.
