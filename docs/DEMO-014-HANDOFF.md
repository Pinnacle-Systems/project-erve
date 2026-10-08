# DEMO-014 PR handoff

Suggested title: `feat: DEMO-014 Distributor Retail Store Master`

Branch: `feature/demo-014-distributor-retail-store-master`

Worktree: `C:/Users/kalay/workspace/erve-demo-014-retail-store-master`

Base: synchronized, clean `main` at `57b77ff`. All implementation work is isolated in the feature worktree. No PR creation, merge or post-merge cleanup is authorized in this handoff.

## Changes

- Distributor-owned Retail Store master with required Code, Name, Address Line 1, City, State and PIN; optional GSTIN, address line 2 and contacts; Country and Active/Inactive status.
- Database uniqueness on `(distributor_id, code)`, immutable Store owner trigger, restrictive Store foreign keys and destination/Distributor ownership trigger. No hard-delete endpoint.
- `GET /retail-stores` provides bounded cursor pagination, search by Code/Name and Distributor/status filters. `GET /retail-stores/options` returns bounded active Stores scoped to a required Distributor. `GET /retail-stores/:id`, `POST /retail-stores`, `PATCH /retail-stores/:id` and `PATCH /retail-stores/:id/status` provide detail, creation, editing and activation/inactivation.
- ADMIN and MERCHANDISER maintain Stores; SENIOR_MANAGEMENT can read. These reuse existing Distributor master roles. Routes and services enforce permissions, and Store mutations record transactional audit events.
- Compact list/detail/create/edit screens use existing ERVE components. The shared editor groups Store Identity, Address and Contact Information. Parent Dispatch Order fields, allocation rows and errors remain mounted through inline creation, failure and cancellation. Successful inline creation refreshes lookup queries and selects the created active Store. Generation tokens reject late callbacks from canceled or superseded dialogs.

## Destination snapshots

| Retail Store field | Dispatch Order destination snapshot |
| --- | --- |
| ID | `retailStoreId`, separate reference |
| Code | `storeCode` |
| Name | `label` |
| Address Line 1/2 | `addressLine1`, `addressLine2` |
| City, State, Country, PIN | `city`, `state`, `country`, `postalCode` |
| GSTIN | `gstin` |
| Contact Person, Email, Phone | `contactName`, `contactEmail`, `contactPhone` |

New selections resolve authoritative master fields inside the existing Dispatch Order transaction, sharing sorted advisory locks with master edits/status changes. Backend ownership and active-status checks apply independently of UI filtering. Unchanged references retain their snapshots and remain valid after inactivation. Explicit `refreshStoreSnapshot: true` on an authorized edit recaptures the same active Store; ordinary edits never implicitly refresh it. The existing version/idempotency, allocation, carton audit invalidation and Factory Dispatch lock rules remain in force.

Factory Packing List/cartons/Packing Audit consume the saved destination row. Erve Packing List copies that snapshot, including new nullable Code and GSTIN fields; Erve Dispatch details/PDFs read the persisted packing snapshot. Invoice handoff continues using its existing finalized dispatch/line relationships. Existing address-plus-Distributor consolidation is retained, including its representative origin destination; Stores are never matched across Distributors by Code or Name.

## Migrations and compatibility

- `20261008000000_demo014_retail_store_master`: master, constraints/triggers, nullable destination Store reference and Code.
- `20261008000100_demo014_downstream_store_snapshot`: nullable Erve Packing List destination Code/GSTIN.
- Both applied successfully with `prisma migrate deploy` to the safety-validated disposable `erve_test` database. Prisma generation and schema validation passed. Development/production databases were not migrated.
- Historical/manual destinations without Store IDs remain supported. No historical name/address matching or rewrites; old nullable packing snapshot fields remain untouched. No new lifecycle, assortment allocation, inventory, accounting or full DEMO-015 rollout.

## Focused local verification

64 API tests passed across affected files and explicitly selected downstream cases:

- `src/modules/sale-orders/dispatch-orders.test.ts`: 48 existing Dispatch Order tests.
- `src/modules/master-data/retail-stores.test.ts`: 3 Store API integration tests.
- `src/modules/master-data/retail-stores.validation.test.ts`: 3 validation tests, including partial edits retaining inactive status/country and rejecting empty edits.
- `src/modules/sale-orders/retail-store-destinations.test.ts`: 5 snapshot/ownership/legacy/multi-Distributor/downstream tests.
- Five selected tests in `factory-dispatch.test.ts` and `erve-dispatch.test.ts`: single-destination cartons, address audit invalidation, same-address consolidation, mixed-destination rejection and identical-address cross-Distributor rejection. Unrelated cases were skipped using `-t`.

131 Web tests passed in this final focused command:

```text
pnpm --filter @erve/web exec vitest run src/pages/master-data/RetailStoreEditor.test.tsx src/pages/master-data/RetailStorePages.test.tsx src/pages/sale-orders/SaleOrderFormPage.test.tsx src/pages/sale-orders/SaleOrderDetailPage.test.tsx src/pages/AppLayout.test.tsx src/routes/AppRoutes.permissions.test.tsx src/pages/fulfillment/ErvePackingListDetailPage.test.tsx src/pages/fulfillment/ErveDispatchDetailPage.test.tsx src/pages/fulfillment/pdf/dispatch-order/buildDispatchOrderDetailViewModel.test.ts src/pages/fulfillment/pdf/factory-packing-list/buildFactoryPackingListViewModel.test.ts src/pages/fulfillment/pdf/erve-packing-list/buildErvePackingListDetailViewModel.test.ts src/pages/fulfillment/pdf/erve-dispatch/buildErveDispatchDetailViewModel.test.ts
```

Typechecks passed for `@erve/api`, `@erve/web`, `@erve/shared` and `@erve/types`; ESLint passed for changed TypeScript files. Prisma validation and `git diff --check` passed. Independent review found no remaining Critical/Important issues after the cancellation fix and partial-update validation fix.

No full API/Web regression suite ran locally. Existing PR CI must pass before closing DEMO-014: Typecheck/lint/build/client/design-system/full-Web tests; migration deployment/seed/full API integration tests on PostgreSQL; deployment script/workflow validation. Feature-branch push alone does not trigger the current PR-only CI checks.

## Remaining handoff

Create the PR manually against `main` with the title above. Full CI remains pending that PR. No unresolved business decisions were introduced; legacy compatibility and existing consolidation behavior are retained. Preserve the worktree and branch until explicit merge confirmation, then perform the requested main synchronization and cleanup.
