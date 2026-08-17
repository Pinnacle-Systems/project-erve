# Process Flow Quality Activities

## Responsibility boundaries

The Quality Form Master defines **what information is collected**: checklists, AQL results, defects, corrective actions, evidence, tests, comments, and sign-off. It deliberately contains no Production activity association, availability trigger, or percentage threshold.

A versioned Process Flow Quality activity defines **when the form becomes relevant or available** and **which Production activity it relates to**. It references one exact `QualityFormVersion.id`; publishing a newer form version never changes an existing Process Flow version.

Job Order and QA runtime execution will later determine what is happening for a specific order. This phase does not create inspections, calculate progress, automatically start Quality work, route outcomes, block Production, or create rework.

As a temporary operational safety rule, a Process Flow version containing any `QUALITY` activity cannot be assigned to a new Job Order. The API rejects such assignment and the web selector disables the version. This guard must be removed only when Job Order Quality runtime execution is implemented, so configured Quality work can never be silently ignored.

## Activity types and execution

Existing Process Flow stages migrate as `PRODUCTION` activities and retain their sequence and runtime behavior. No Quality activities or thresholds are added by migration.

A `QUALITY` activity uses one of these execution modes:

- `SEQUENTIAL_GATE`: a normal ordered gate that references a Quality Form version. It has no Production association or progress trigger.
- `IN_PROCESS`: a Quality activity explicitly associated with a `PRODUCTION` activity in the same Process Flow version. Its array position does not imply that the associated Production activity has completed.

The currently supported in-process availability policies are:

- `WHILE_ASSOCIATED_ACTIVITY_ACTIVE`: represents Inline Inspection associated with Sewing. It has no percentage threshold.
- `PROGRESS_PERCENTAGE`: represents Final Inspection associated with Finishing. Availability begins when Finishing progress reaches the configured threshold. The current customer value is `50`, stored as Process Flow version configuration rather than application logic or Quality Form data.

Availability means eligible or ready to start; it does not automatically execute an inspection.

## Version integrity

New selections use published versions of active Quality Forms. Historical Process Flow versions keep restrictive references to their exact Quality Form versions and remain readable if those versions are later retired. Copying a Process Flow version preserves the exact selected form version until a user explicitly selects another version in an editable draft.

Process Flow `ACTIVE` and `RETIRED` versions remain immutable. Changing an activity type, form version, execution mode, Production association, availability policy, or threshold requires a new Process Flow version.
