# Process Flow Quality Activities

## Responsibility boundaries

The Quality Form Master defines **what information is collected**: checklists, AQL results, defects, corrective actions, evidence, tests, comments, and sign-off. It deliberately contains no Production activity association, availability trigger, or percentage threshold.

A versioned Process Flow Quality activity defines **when the form becomes relevant or available** and **which Production activity it relates to**. It references one exact `QualityFormVersion.id`; publishing a newer form version never changes an existing Process Flow version.

Job Order and QA runtime execution determine what is happening for a specific order. Quality work is explicitly started; Inline/Final outcomes do not automatically alter Production or create rework.

As a temporary operational safety rule, a Process Flow version containing any `QUALITY` activity cannot be assigned to a new Job Order. The API rejects such assignment and the web selector disables the version. Quality activity execution now exists, but the guard remains until a subsequent feature deliberately enables assignment for normal new Job Orders.

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

## Version integrity

New selections use published versions of active Quality Forms. Historical Process Flow versions keep restrictive references to their exact Quality Form versions and remain readable if those versions are later retired. Copying a Process Flow version preserves the exact selected form version until a user explicitly selects another version in an editable draft.

Process Flow `ACTIVE` and `RETIRED` versions remain immutable. Changing an activity type, form version, execution mode, gate rule, Production association, availability policy, multiplicity, coverage target, or threshold requires a new Process Flow version.
