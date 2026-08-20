# Process Flow Quality Activities

## Responsibility boundaries

The Quality Form Master defines **what information is collected**: checklists, AQL results, defects, corrective actions, evidence, tests, comments, and sign-off. It deliberately contains no Production activity association, availability trigger, or percentage threshold.

A versioned Process Flow Quality activity defines **when the form becomes relevant or available** and **which Production activity it relates to**. It references one exact `QualityFormVersion.id`; publishing a newer form version never changes an existing Process Flow version.

Job Order and QA runtime execution determine what is happening for a specific order. Quality work is explicitly started; Inline/Final outcomes do not automatically alter Production or create rework.

The blanket Quality assignment guard has been replaced by runtime-capability validation. Process Flow Master remains able to store and activate valid future configurations. A new Job Order can use a version only when every active Quality activity matches a runtime-supported semantic pattern and its exact published form version has executable components and stable system-source identifiers. API assignment is authoritative; the web selector shows the same result and activity-name-based reason.

## Confirmed Erve configuration

The seed/master-data convention configures `ERVE_PRODUCTION_QUALITY` version 1 after the four published Quality Forms exist. It stores their exact version IDs and never upgrades an existing version on a later seed run.

1. PP SAMPLE CHECKLIST — Quality, SAMPLE form, `SIZE`, `SEQUENTIAL_GATE`, `OUTCOME_PASS`, `SINGLE`
2. SIZE SET / PRE-PRODUCTION REPORT — Quality, PPM form, `JOB_ORDER`, `SEQUENTIAL_GATE`, `FINALIZED`, `SINGLE`
3. CUTTING — Production
4. PRINTING — Production
5. SEWING — Production
6. INLINE INSPECTION — Quality, INLINE form, `JOB_ORDER`, `IN_PROCESS`, `SINGLE`, associated with Sewing, `WHILE_ASSOCIATED_ACTIVITY_ACTIVE`
7. FINISHING — Production
8. FINAL INSPECTION — Quality, FINAL form, `JOB_ORDER`, `IN_PROCESS`, `BATCHED`, associated with Sewing, `AFTER_ASSOCIATED_ACTIVITY_COMPLETES`, `PREPARED_QUANTITY`

Factory acknowledgement makes PP Sample available. A PP Sample execution chooses one Job Order size and a positive quantity and bridges to exactly one ERVE-015 size form. Its QA PASS/FAIL is explicit. FAIL preserves the finalized cycle and permits an explicit new cycle; a later finalized PASS satisfies the gate. PPM then becomes available, and its finalization unlocks Cutting.

`attemptNumber` is the PP Sample cycle number. PP Sample cycles always use batch 1. Final Inspection currently remains attempt 1 and uses independent, increasing batch numbers. This separation reserves future Final reinspection attempts without conflating attempts and physical batches.

Inline is available only while Sewing is active. A draft started in that window remains editable after Sewing completes. If none was started, the derived state is `MISSED`; the runtime does not start one late or change Production history.

Final becomes available when Sewing completes, independently of Finishing percentage or incremental factory quantities. It is consolidated at Job Order scope. Finalized `inspectedQuantity` values reconcile against the sum of `JobOrderLineSize.preparedQuantity`; drafts do not count. Zero/unsubmitted prepared quantity is treated as unknown, so a draft can be saved but not finalized. Coverage is `UNKNOWN`, `IN_PROGRESS`, `COMPLETE`, or `CONFLICT`. Batch PASS/FAIL counts are reported separately; a failed batch still counts as physical coverage and has no automatic rework or Production effect.

For this Process Flow, recording prepared quantity keeps the top-level Job Order at `PRODUCTION_COMPLETE` and feeds Final coverage. It does not enter the legacy `READY_FOR_QA` queue. Production-only flows retain the existing `READY_FOR_QA` transition and full multi-size ERVE-015 inspection/rework/approval lifecycle. Detailed Production stages, Quality gates, Final coverage, and Quality outcomes remain separate runtime facts; Production completion is not presented as QA approval.

## Activity types and execution

Existing Process Flow stages migrate as `PRODUCTION` activities and retain their sequence and runtime behavior. No Quality activities or thresholds are added by migration.

A `QUALITY` activity uses one of these execution modes:

- `SEQUENTIAL_GATE`: a normal ordered gate satisfied by configured `FINALIZED` or `OUTCOME_PASS` semantics. It has no Production association or progress trigger.
- `IN_PROCESS`: a Quality activity explicitly associated with a `PRODUCTION` activity in the same Process Flow version. Its array position does not imply that the associated Production activity has completed.

The currently supported in-process availability policies are:

- `WHILE_ASSOCIATED_ACTIVITY_ACTIVE`: represents Inline Inspection associated with Sewing. It has no percentage threshold.
- `AFTER_ASSOCIATED_ACTIVITY_COMPLETES`: represents the current Final Inspection rule associated with Sewing.
- `PROGRESS_PERCENTAGE`: retained as a generic configurable capability for other Process Flows; it is not the current Final rule.

In-process activities also declare `SINGLE` or `BATCHED` execution multiplicity. Batched activities currently require `PREPARED_QUANTITY` coverage. The current Final configuration is batched and completion-based; there is no customer-specific 50% gate.

Availability means eligible or ready to start; it does not automatically execute an inspection.

## Supported runtime patterns

- PP Sample: `INSPECTION / SIZE / SEQUENTIAL_GATE / OUTCOME_PASS / SINGLE`, through the ERVE-015 bridge.
- PPM: `MEETING / JOB_ORDER / SEQUENTIAL_GATE / FINALIZED / SINGLE`.
- Inline: `INSPECTION / JOB_ORDER / IN_PROCESS / SINGLE / WHILE_ASSOCIATED_ACTIVITY_ACTIVE`.
- Final: `INSPECTION / JOB_ORDER / IN_PROCESS / BATCHED / AFTER_ASSOCIATED_ACTIVITY_COMPLETES / PREPARED_QUANTITY`.

The existing QA supervision navigation also lists Process Flow Quality work, including available work, failed PP Sample retry, Inline draft/missed state, Final remaining quantity, and reconciliation conflicts.

## Intentionally unsupported

- Inline FAIL blocking, Production rollback, or automatic rework.
- Final FAIL approval/rejection, automatic rework, or attempt 2.
- Automatic reinspection for generic Quality activities.
- Other future semantic Process Flow combinations until implemented by the runtime.
- Automatic replacement of an assigned Quality Form version with a newer published version.

## Version integrity

New selections use published versions of active Quality Forms. Historical Process Flow versions keep restrictive references to their exact Quality Form versions and remain readable if those versions are later retired. Copying a Process Flow version preserves the exact selected form version until a user explicitly selects another version in an editable draft.

Process Flow `ACTIVE` and `RETIRED` versions remain immutable. Changing an activity type, form version, execution mode, gate rule, Production association, availability policy, multiplicity, coverage target, or threshold requires a new Process Flow version.
