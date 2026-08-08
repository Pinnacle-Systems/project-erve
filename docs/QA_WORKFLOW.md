# QA inspection and rework domain

## Decisions and bounded assumptions

### ERVE-015 pre-production migration treatment

- `qa_inspection_lines` is renamed to `qa_size_inspection_forms`. Its quantity, defect, rework-source and canonical `job_order_line_size_id` facts are retained because each row already identifies exactly one size allocation.
- `qa_inspection_checklist_items` is replaced by an empty per-form checklist table. Its former session-wide answers and remarks are reset: they cannot be truthfully assigned to a size.
- Session-wide `qa_inspection_sessions.sample_quantity` and `notes` are removed without copying them to forms. No placeholder sample quantity, checklist response, remark, or inspection remark is created.
- QA sessions, evidence, rework tasks and size-owned inspection outcomes are retained. Job orders, POs, styles, sizes, factories, distributors and all other master data are untouched.

- An active `QA_USER` initiates an inspection from the global QA queue. Factory mappings are not required for QA visibility or inspection; admins and merchandisers may also act for exception resolution. Senior management is read-only.
- The shared `user_factories` relation remains for `FACTORY_USER` workflows and other legitimate mappings; it is no longer read by the active QA workflow, so no schema migration removes shared mapping data.
- Inspection is a partial, versioned session against job-order size allocations. Each inspected `JobOrderLineSize` owns a complete `QaSizeInspectionForm`: its sample quantity, all 15 checklist responses and row remarks, inspection remarks, quantities, outcome and defect detail. A session holds only the shared job order, cycle, inspector and lifecycle facts.
- Draft forms reserve first-pass or rework quantity. A user can correct their own draft. Finalized sessions and their per-size forms are immutable facts.
- Accepted quantities remain provisional until job-level `QA_APPROVED`. Only then is the derived accepted total copied to the purchase-order QA-passed counter and exposed as `finalApproved` for the future warehouse workflow.
- Approval aggregates finalized size forms by disposition: first-pass forms establish prepared-quantity coverage, and a reinspection resolves only its linked rework quantity. A first-pass rework quantity is therefore not an additional terminal quantity; terminal accepted plus permanently rejected quantities across the finalized form history must reconcile to prepared quantity exactly once.
- Defects use the controlled `QaDefectCategory` enum. Defect category is required for rework or permanent rejection; notes remain optional. Permanent rejection requires photo evidence, an established pre-ERVE-015 rule. Evidence is optional at session scope but, when used to satisfy permanent rejection, is attached to the exact rejected size form; one attachment therefore does not silently satisfy another size's rejection. Rework alone does not require evidence.
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

For every size inspection form:

```text
inspected = accepted + rework + permanently rejected
```

All terms are non-negative. PostgreSQL `CHECK` constraints enforce both rules. Constraint triggers lock the size or rework row and enforce aggregate first-pass and reinspection capacity. The API also holds a transaction-scoped advisory lock per job order so it can return a stable conflict before a database constraint error.

First-pass finalized plus draft-reserved quantity cannot exceed prepared quantity. Reinspection cannot exceed its source rework task. Open rework must be zero before approval. Initial finalized inspection must equal prepared quantity, and terminal accepted plus permanently rejected outcomes across every cycle must also equal prepared quantity. Final approved quantity is derived on the server from finalized accepted lines.

## API contract

### ERVE-015 route migration

| Legacy intent | Retired route | Replacement |
| --- | --- | --- |
| Save a QA draft | `PUT /qa/inspections/:id` | `PUT /qa/inspections/:sessionId/forms/:formId` |
| Finalize an inspection | `POST /qa/inspections/:id/finalize` | `POST /qa/inspections/:sessionId/forms/:formId/finalize` |
| Reopen an inspection | `POST /qa/inspections/:id/reopen` | `POST /qa/inspections/:sessionId/forms/:formId/reopen` |
| Create rework | session finalization | finalization of the exact source size form |

The former session-wide routes are intentionally absent. Test migration must retain their business assertions using the replacement form selected from the started session.

- `GET /qa/queue` — compact cursor-paginated queue; filters: state, factory, date range and job/PO search.
- `GET /qa/job-orders/:id` — reconciliation, sessions, evidence metadata and rework.
- `POST /qa/job-orders/:id/inspections` — start first inspection or selected reinspection.
- `PUT /qa/inspections/:sessionId/forms/:formId` — save exactly one versioned size form. The server creates all eligible forms at session start; clients cannot add, remove, or overwrite sibling forms.
- `POST /qa/inspections/:sessionId/forms/:formId/finalize` — freeze exactly one size form and create only its rework task.
- `POST /qa/job-orders/:id/approve` — publish authoritative final quantity.
- `POST /qa/inspections/:sessionId/forms/:formId/reopen` — admin/merchandiser exception action for one finalized form that did not generate rework.
- `POST /qa/inspections/:id/evidence` and `GET /qa/evidence/:id/content` — authorized evidence lifecycle.
- `GET /qa/rework`, `POST /qa/rework/:id/acknowledge`, `POST /qa/rework/:id/ready` — minimum factory handoff.

Every business mutation requires `expectedVersion` and `Idempotency-Key`. Records are scoped by actor and operation and include a SHA-256 request hash. Exact replay returns current authoritative detail without a second mutation or audit event. Key reuse with another entity or payload returns `IDEMPOTENCY_KEY_REUSED`. Mutation, version, idempotency record and audit commit in one transaction.

## Explicit exclusions

No warehouse record, receipt, allocation, reservation, packing, dispatch, invoice, return, payment, notification, dashboard, Tally integration or general offline synchronization is created here. `QA_APPROVED` and `finalApproved` are the only handoff contract for the future warehouse availability and reservation slice.
