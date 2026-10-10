# Tax Invoice final payable rounding (PR0)

Business policy approved on 10 October 2026: round the final payable to the
nearest whole rupee with `ROUND_HALF_UP`, directly from the exact aggregate
taxable value plus GST. Do not round individual lines or tax components.

## Snapshot contract

- `grandTotal`: existing aggregate rounded to two decimal places; semantics
  and calculation remain unchanged.
- `payableTotal`: exact aggregate rounded directly to zero decimal places,
  stored and exposed as a two-decimal monetary amount.
- `roundOffAdjustment`: signed `payableTotal - grandTotal`.
- `roundingPolicy`: `NEAREST_RUPEE_HALF_UP_V1`, frozen at finalization.

For taxable value 41,952.00 and GST 2,097.60, the snapshots are 44,049.60,
44,050.00 and +0.40 respectively. An exact aggregate of 11.4975 instead has
`grandTotal` 11.50, `payableTotal` 11.00 and adjustment -0.50: rounding
`grandTotal` again would incorrectly produce 12.00.

The payable helper uses a local 40-significant-digit Decimal constructor to
avoid implicit arithmetic rounding when adding the stored aggregate scales.
It does not change the existing calculation engine's global precision.

The new snapshots are persisted with the existing finalization transaction,
EI allocation and financial audit. The existing authorization, lifecycle
locks and repeated-finalization behavior remain unchanged. API additions
are nullable decimal strings (two decimal places) and a nullable policy
identifier; zero is serialized as `0.00`, not null.

## Legacy documents

The migration adds nullable columns without defaults or data updates.
Previously finalized invoices retain their issued totals and unavailable
rounding snapshots. Reads and repeated finalization must not compute,
populate or replace these fields. A null adjustment is not an adjustment of
zero. Drafts also have null snapshots until finalization.

## Downstream implications (outside PR0)

- INV-007 review and INV-008 PDF must consume the backend snapshots. Show
  the pre-rounding total, signed adjustment and final payable together;
  amount in words must follow the issued payable amount. Legacy documents
  retain their existing issued `grandTotal` and must not imply that the new
  rounding policy was applied.
- Credit Notes must preserve original line/tax provenance and account for
  the invoice's rounding policy separately. Allocation of invoice-level
  round-off across partial credits needs its own approved policy; it must
  not change original GST or automatically copy the entire adjustment into
  every partial credit.
- Reporting must distinguish taxable/GST aggregates from amounts payable.
  Receivable reconciliation needs the frozen payable when available and
  the original issued total for legacy documents, with provenance retained.

## Implementation and verification plan

1. Verify main and parallel work; create an isolated feature worktree.
2. Create a unique local disposable test database and verify the repository
   safety guard before migrations, seeding or write-capable tests.
3. Add focused failing arithmetic/API tests, including double-rounding,
   legacy null snapshots, repeat finalization and concurrency.
4. Add the nullable schema fields and migration, then the pure payable
   calculation, atomic persistence, API serialization and audit metadata.
5. Run focused tests and relevant API regressions, typecheck, lint,
   formatting and build; review the complete diff against approved scope.
6. Commit and push the feature branch. The user creates the PR and merges
   only after all required GitHub checks pass. Preserve the worktree until
   user-confirmed merge and agent verification of origin/main.

No INV-007/008 UI or PDF, Style workstream, Credit Note/reporting feature,
production migration, GST activation or EI cutover is part of PR0.
