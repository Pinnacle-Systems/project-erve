# Quality Activity Execution

Quality activities run against the exact activity and `QualityFormVersion` selected by the assigned Process Flow version. Drafts use optimistic concurrency, finalized records are immutable, and responses, attendees, actions, signatures, outcomes, evidence, and audit events remain execution-scoped.

## Process Flow behavior

Sequential gates declare how they are satisfied:

- `OUTCOME_PASS` requires a finalized execution with the controlled `PASS` outcome.
- `FINALIZED` requires a finalized execution and does not fabricate an outcome.

In-process activities declare availability (`WHILE_ASSOCIATED_ACTIVITY_ACTIVE`, `AFTER_ASSOCIATED_ACTIVITY_COMPLETES`, or the retained generic `PROGRESS_PERCENTAGE`), multiplicity (`SINGLE` or `BATCHED`), and an optional controlled coverage target (`PREPARED_QUANTITY`). These rules belong to immutable Process Flow version configuration rather than form-code branches.

Factory acknowledgement makes every sequential Quality gate that precedes the first Production activity eligible at the same time — PP Sample and PPM are independent, parallel gates, not a chain. A `SEQUENTIAL_GATE` activity's eligibility depends only on the nearest preceding `PRODUCTION` activity completing (or factory confirmation, if none precedes it); it never depends on another Quality gate's lifecycle or result. Before Production can start, every such gate is evaluated independently and directly from its own finalized executions. Production runtime rows remain Production-only.

## PP Sample bridge

The PP Sample Process Flow path reuses the ERVE-015 `QaInspectionSession` and `QaSizeInspectionForm` runtime. Starting it creates one Quality execution, one linked QA session, and one size form for the QA-selected Job Order size. The positive sample quantity and size are locked after start; no all-size tabs or Factory sample-preparation state are created.

QA must explicitly select `PASS` or `FAIL` while finalizing the size form. This gate outcome is stored on the linked Quality execution and is not inferred from checklist, accepted, rework, rejection, or defect values. A Process Flow gate configured as `OUTCOME_PASS` is satisfied only by explicit `PASS`; `FAIL` leaves Cutting locked on the PP Sample gate specifically, independently of PPM's own state. The decision is immutable, and PP retry/reopen is intentionally unavailable until a retry model is defined.

The ERVE-015 session and size-form internals remain reusable infrastructure for PP Sample execution. Unlinked sessions are not an alternative end-user workflow and prepared quantity does not create or route work into them.

The PP Sample adapter reuses the strongly typed checklist, remarks, defect information, and evidence association only. Its save contract omits inspected, accepted, rework, and permanently rejected quantities; its shared form row retains inert zero defaults for physical-schema compatibility. PP finalization does not reconcile those columns, require disposition evidence, or create rework. The selected size, locked sample quantity, completed checklist, and explicit `PASS` or `FAIL` are authoritative.

## PPM / Size Set

PPM is one `MEETING + JOB_ORDER` execution. Its authoritative Job Order context is read-only; meeting/planning fields are user-entered `FIELD_GROUP` values. `ATTENDEE_LIST` and `SIGNATURES` use normalized runtime records and definition-driven finalization validation. PPM has no size tabs and no fabricated PASS/FAIL. PPM becomes available at the same time as PP Sample, immediately after factory confirmation, and can be started, edited, or finalized independently of PP Sample's lifecycle or result. A `FINALIZED` PPM gate satisfies PPM's own requirement toward the first valid Production activity in normal sequence, but Cutting also independently requires PP Sample to be finalized with `PASS`.

Corrected published definitions are created as successor versions only when an existing published PPM definition needs correction. Historical definitions and Process Flow references are not silently rewritten.

### DEMO-008: participants, remarks, follow-up, evidence

The current (successor) PPM definition's `ATTENDEE_LIST` carries exactly 6 confirmed participant categories — Merchandiser, QA, Outward Processing, Sewing, Fabric, Others — each a person-name entry, not a Yes/No attendance flag. `QualityAttendeeResponse` carries an additive, nullable `remarks` column alongside `attendeeName`: remarks belong to the corresponding participant record, are optional, and historical rows (and older client payloads that omit the field) read back as `null` with no validation or rendering failure.

The old repeating `ACTION_LIST` follow-up (action / follow-up person / settle date rows) is replaced in the current definition by a single `COMMENTS` component ("Follow-up") — one free-text note, no task assignment, deadlines, or escalation. An optional `ATTACHMENTS` component ("Photo evidence") was added with no `required`/`requiredWhen` flag, so PPM saves and finalizes with or without photos.

Both changes only affect the *current* PPM Quality Form version. Executions pinned to an earlier published PPM version keep rendering their original `ACTION_LIST` content and attendee rows without remarks — every Quality Form version (current or historical) renders generically from its own stored component types and responses, so no historical rewrite or migration of past executions is needed or performed.

## Inline and Final

Inline remains one consolidated Job Order execution available while its associated Production activity is active. Its PASS/FAIL result does not alter Production or create rework.

Final is one consolidated Job Order requirement with multiple form executions representing physical batches. `attemptNumber` identifies the inspection cycle (currently only attempt 1); `batchNumber` independently identifies batches within it. Every batch has a strongly typed positive `inspectedQuantity` that also supplies the form's read-only `BATCH_INSPECTED_QUANTITY` system field.

Final becomes available after its associated activity (currently Sewing) completes. The customer workflow has no 50% or incremental Production-progress gate. Finalized batch quantities are summed against the authoritative total `JobOrderLineSize.preparedQuantity` across the Job Order. Draft batches do not count. Finalization is locked transactionally so concurrent batches cannot exceed prepared quantity.

The UI reports prepared, inspected, and remaining quantities. Coverage completes only when finalized inspected quantity equals authoritative prepared quantity. If prepared quantity later rises, remaining coverage becomes available; if it falls below finalized history, the runtime reports a reconciliation conflict without rewriting history. Batch FAIL still counts physical coverage and does not control Production or create rework.

The corrected FINAL successor contains controlled `PASS` / `FAIL`, binds quantity inspected to the batch quantity, and evaluates failed-part evidence against the persisted controlled outcome. AQL data remains independent of 100% operational coverage.

## Availability before prepared quantity is authoritative

Prepared quantity is entered per Job Order size after Production completion in the current workflow. An early Final batch may be saved truthfully as a draft, but it cannot be finalized while the aggregate prepared quantity is zero. Once prepared quantities are authoritative, coverage and overrun validation use their current aggregate; finalized history is never altered.

## Guard

The existing guard that prevents assigning Quality-enabled Process Flows to normal new Job Orders remains active. Controlled fixtures exercise this runtime until a separate feature deliberately removes that guard.

## DEMO-007 version transition

Canonical successors remove Inline packing/corrective-action capture and Final's duplicate packing/labelling component and on-site GSM. Summary GSM and packing/labelling, Metal Detection outside PP Sample, global AQL levels, calculated outcomes, Inline PASS completion gating, and Final batch release accounting remain intact. Final attachment capture is optional; mandatory failure/rejection explanations remain enforced independently.

The bootstrap publishes successor forms and an active successor Process Flow referencing the current forms. New Job Orders explicitly select the active flow through the existing selection/API contract. Existing Job Orders, drafts, and finalized executions retain their pinned versions. Development/test seeding uses frozen historical definitions before installing canonical successors; reruns never replace historical content or downgrade an active successor. Production bootstrap or deployment requires separate authorization.
