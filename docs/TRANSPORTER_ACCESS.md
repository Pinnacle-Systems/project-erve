# Assigned Transporter access (ISS-078 / A2)

TRANSPORTER is an exclusive account role. Admin creates a dedicated account in User Management; it cannot also hold any internal, factory, QA or distributor role. Existing internal role combinations retain their permissions. Invalid legacy mixed Transporter accounts fail authentication closed.

Admin/Merchandiser assigns, replaces or clears one current Transporter account in the existing Dispatch Transport & Delivery tab. The account must be active and exclusively TRANSPORTER. A Transporter can serve many dispatches. The nullable user FK is independent of historical free-text `transporter`; there is no name matching, historical backfill or new Transporter master.

Transporter navigation opens Assigned Dispatches and a restricted Transport & Delivery workspace. It uses only the assigned-list and minimal transport detail APIs. Overview, receipt, delivery confirmation, packing, financial documents, full-dispatch PDFs, sales and returns remain unavailable. Public QR delivery is separate and excluded.

## Authorization boundaries

| Surface                                             | Allowed                                                     |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `GET /erve-dispatches/assigned-transport`           | Exclusively TRANSPORTER; query scoped to current user       |
| `GET /erve-dispatches/:id/transport`                | ADMIN/MERCHANDISER; assigned TRANSPORTER                    |
| `PATCH /erve-dispatches/:id/lr`                     | ADMIN/MERCHANDISER; assigned TRANSPORTER                    |
| `PATCH /erve-dispatches/:id/transporter-assignment` | ADMIN/MERCHANDISER                                          |
| `GET /erve-dispatches/transporter-options`          | ADMIN/MERCHANDISER; bounded active exclusive-account lookup |
| Existing full Dispatch/Packing/delivery APIs        | Existing roles; TRANSPORTER excluded                        |

Transport DTOs contain only identity/date/status, transporter/vehicle/LR, version and LR update timestamp. Only assignment managers additionally receive current assignee ID/name. Existing internal LR callers retain the full response. No general User Management permission is granted to Merchandisers.

Assignment and transport writes share the dispatch advisory lock, expected-version check and conditional update. Assignment changes increment version and audit old/new account IDs; repeated unchanged assignments do not create new events. LR writes preserve the original audit action and updater metadata. Transporter writes condition on assignment identity and check ownership before reporting version conflicts. Account permissions and assignment are reread for the response.

## Release prerequisites

1. Apply `20261105120000_add_transporter_role`, then `20261105120100_add_dispatch_transporter_assignment`. The enum addition must commit before any bootstrap use of TRANSPORTER. Neither migration inserts a role row or requires one to exist.
2. Run the existing idempotent `roles:bootstrap` with the release's updated role declarations, after the enum migration. Do not run the broad development seed for provisioning.
3. Release the compatible application, then provision accounts and explicitly assign dispatches.

Order: **schema migrations → role bootstrap → application release → account provisioning/assignment**. No existing environment was migrated during implementation. Preserve the additive database changes if rolling back application code; do not remove the enum value or historic assignments.

## Verification boundaries

Local verification uses named database-free API tests, named React tests, affected-file diagnostics and one mocked Chromium smoke. PostgreSQL integration cases in `erve-dispatch-transporter.test.ts` are for PR CI, including actual transaction rollback and concurrent incompatible role grants. Full builds, integration suites, migration replay and comprehensive regression remain CI responsibilities. No CI polling, merge, deployment or issue-tracker changes are part of the implementation handoff.

## Merge-order dependency

[E-Way Bill B2B PR #204](https://github.com/Pinnacle-Systems/project-erve/pull/204) must merge first. A2 remains based on merged main and contains no B2B code. After #204 merges, synchronize A2 with latest main, preserve both User inverse relations, and verify CI again on that latest A2 head before authorizing merge. B2B owns `20261105090000_eway_bill_b2b`; A2 reserves `20261105120000_add_transporter_role` then `20261105120100_add_dispatch_transporter_assignment`. The SQL affects only RoleName and the Erve Dispatch association, never E-Way Bill objects.

## Observed in the AW26 run (2026-11-12)

The Transporter saw 5 assigned dispatches, recorded vehicle and LR, was refused the full dispatch (403) and received a transport view with no Distributor or financial data.
