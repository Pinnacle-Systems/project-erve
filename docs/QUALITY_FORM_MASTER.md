# Quality Form Master

The Quality Form Master defines **what information is collected**. Process Flow Quality activities define **when a quality activity occurs**, and runtime quality records store **what actually happened**.

## Phase-one boundary

- `QualityForm` owns the stable business code, name, description, and active/inactive lifecycle.
- `QualityFormVersion` owns activity type (`MEETING` or `INSPECTION`), execution scope (`JOB_ORDER` or `SIZE`), and the component definition. These properties affect interpretation, so all are immutable after publication. Versions move from `DRAFT` to `PUBLISHED`; a former published version becomes `RETIRED` when its replacement is published.
- Ordered sections contain a finite set of domain-aware components, including a dedicated inspection-outcome declaration rather than a generic outcome field. Component configuration is JSON only at the definition boundary and is validated by a discriminated server schema before persistence.
- AQL criteria are controlled, versioned `AQL_RESULT` configuration in this phase. They can later be replaced by an `AqlProfile` reference if reuse warrants a separate master.
- Runtime system fields require stable `sourceKey` semantics, and Production progress metrics require a stable `sourceActivityCode`. Display labels are presentation only and are never runtime lookup keys.

Quality Forms intentionally contain no production stage, execution mode, availability trigger, or progress threshold. In particular, the Inline form does not encode a Sewing association, and the Final form does not encode a Finishing association or 50% threshold.

## Runtime compatibility

The `SAMPLE` master record represents the QA Sample Checklist conceptually. PP Sample execution reuses the strongly typed ERVE-015 session and per-size form internals; those internals do not constitute a separate prepared-quantity QA workflow.

Process Flow Quality activities reference a specific `QualityFormVersion`. That association distinguishes sequential quality gates from in-process quality checkpoints without changing or duplicating the form definition. See [Process Flow Quality Activities](./PROCESS_FLOW_QUALITY_ACTIVITIES.md).
