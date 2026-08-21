# Quality Activity Execution

Quality activities run against the exact activity and `QualityFormVersion` selected by the assigned Process Flow version. Drafts use optimistic concurrency, finalized records are immutable, and responses, attendees, actions, signatures, outcomes, evidence, and audit events remain execution-scoped.

## Process Flow behavior

Sequential gates declare how they are satisfied:

- `OUTCOME_PASS` requires a finalized execution with the controlled `PASS` outcome.
- `FINALIZED` requires a finalized execution and does not fabricate an outcome.

In-process activities declare availability (`WHILE_ASSOCIATED_ACTIVITY_ACTIVE`, `AFTER_ASSOCIATED_ACTIVITY_COMPLETES`, or the retained generic `PROGRESS_PERCENTAGE`), multiplicity (`SINGLE` or `BATCHED`), and an optional controlled coverage target (`PREPARED_QUANTITY`). These rules belong to immutable Process Flow version configuration rather than form-code branches.

Factory acknowledgement makes the first sequential Quality gate eligible. Earlier sequential Quality gates are evaluated directly from their finalized executions before Production can start. Production runtime rows remain Production-only.

## PP Sample bridge

The PP Sample Process Flow path reuses the ERVE-015 `QaInspectionSession` and `QaSizeInspectionForm` runtime. Starting it creates one Quality execution, one linked QA session, and one size form for the QA-selected Job Order size. The positive sample quantity and size are locked after start; no all-size tabs or Factory sample-preparation state are created.

QA must explicitly select `PASS` or `FAIL` while finalizing the size form. This gate outcome is stored on the linked Quality execution and is not inferred from checklist, accepted, rework, rejection, or defect values. A Process Flow gate configured as `OUTCOME_PASS` is satisfied only by explicit `PASS`; `FAIL` leaves the following PPM gate locked. The decision is immutable, and PP retry/reopen is intentionally unavailable until a retry model is defined.

The ERVE-015 session and size-form internals remain reusable infrastructure for PP Sample execution. Unlinked sessions are not an alternative end-user workflow and prepared quantity does not create or route work into them.

The PP Sample adapter reuses the strongly typed checklist, remarks, defect information, and evidence association only. Its save contract omits inspected, accepted, rework, and permanently rejected quantities; its shared form row retains inert zero defaults for physical-schema compatibility. PP finalization does not reconcile those columns, require disposition evidence, or create rework. The selected size, locked sample quantity, completed checklist, and explicit `PASS` or `FAIL` are authoritative.

## PPM / Size Set

PPM is one `MEETING + JOB_ORDER` execution. Its authoritative Job Order context is read-only; meeting/planning fields are user-entered `FIELD_GROUP` values. `ATTENDEE_LIST`, `ACTION_LIST`, and `SIGNATURES` use normalized runtime records and definition-driven finalization validation. PPM has no size tabs and no fabricated PASS/FAIL. A `FINALIZED` PPM gate unlocks the first valid Production activity in normal sequence.

Corrected published definitions are created as successor versions only when an existing published PPM definition needs correction. Historical definitions and Process Flow references are not silently rewritten.

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
