# Job Order Quality runtime foundation

Job Orders retain their exact immutable Process Flow version. Production runtime continues to use
`JobOrderStageStatus`; `completedQuantity` is the authoritative captured throughput for that
Production activity. Planned quantity is the sum of the Job Order line ordered quantities, while
remaining quantity and percentage are derived and are not persisted.

Ordinary progress updates are integer, monotonic, version-checked, idempotent, and bounded by the
Job Order planned quantity. Reaching the full planned quantity does not complete an activity; the
explicit completion action remains authoritative and rejects completion until the full planned
quantity is recorded. Existing runtime rows are migrated with `NULL` (unknown) progress because
historical throughput cannot be inferred safely; newly created rows explicitly start at actual zero.
Pre-production development data should be reset/recreated before exercising the new workflow.

Quality eligibility is derived rather than persisted. The Job Order detail projection combines the
exact Process Flow Quality activity and Quality Form version with current Production runtime:

- `WHILE_ASSOCIATED_ACTIVITY_ACTIVE` is available only while its associated Production activity is
  `IN_PROGRESS`.
- `PROGRESS_PERCENTAGE` uses decimal-safe cross multiplication of completed quantity, planned
  quantity, and the configured threshold.
- `SEQUENTIAL_GATE` is available when the preceding active sequential activity is completed;
  `IN_PROCESS` Quality activities are deliberately skipped when resolving that predecessor.

Eligibility never starts or completes an inspection. A later Quality execution record can store an
explicit start and multiple attempts against the Job Order, exact Process Flow activity, and exact
Quality Form version without relying on “latest version” lookup.

Quality-enabled Process Flow versions remain intentionally blocked from assignment to new Job
Orders. The foundation is observable for development and testing, but is not an operational Quality
Form-entry workflow.

Unresolved business rules remain deliberately unimplemented: missed Inline Inspection at Sewing
completion, the Production effect of failed Inline or Final Inspection, and whether any QA result
blocks subsequent Production.
