# Design System Import

This note records the first-pass import and migration of the Erve design system foundation.

## Source

The design system packages were imported from:

- `~/workspace/project-erp`

## Imported Packages

The packages are now available in this monorepo under the `@erve/*` namespace:

- `@erve/tokens`
- `@erve/theme`
- `@erve/primitives`
- `@erve/layout`
- `@erve/app-components`
- `@erve/data-display`
- `@erve/client`

## Theme Wiring

- `ThemeProvider` is wired in `apps/web/src/App.tsx`.
- Theme CSS is imported in `apps/web/src/index.css` via `@import '@erve/theme/theme.css';`.

## Screens Migrated

The first-pass screen migration covered:

- Login
- Forbidden
- Dashboard
- App shell/navigation
- `StyleListPage`
- `MasterDataLayout`
- `StyleFormPage`
- `StyleDetailPage`
- `SizeListPage`
- `FactoryListPage`
- `ProcessFlowListPage`
- `ProcessFlowDetailPage`
- `PurchaseOrderListPage`
- `PurchaseOrderFormPage`
- `PurchaseOrderDetailPage`
- `JobOrderListPage`
- `JobOrderCreatePage`
- `JobOrderDetailPage`

## Commonly Used Components

The migrated screens now commonly use:

- `PageHeader`
- `StatusBadge`
- `FilterBar`
- `ConfirmDialog`
- `AuditTrail`
- `TotalsPanel`
- `DataTable`
- `LoadingState`
- `EmptyState`
- `ErrorState`
- `Card`
- `Panel`
- `FormGrid`
- `FormSection`
- `Stack`
- `DescriptionList`
- `DataLabel`
- `Divider`
- `Button`
- `TextField`
- `SelectField`
- `DatePicker`
- `Badge`
- `ValidationMessage`
- `FieldGroup`
- `Skeleton` variants

## Deferred Components

- `EditableGrid` is intentionally deferred.
- Advanced editable PO quantity grids are still using lower-level primitives for now.
- Job-order quantity entry uses `DataTable` plus field primitives for the first pass.
- Audit sections remain placeholder panels until a read API for audit logs is exposed.

## Tailwind Compatibility

The web app remains on Tailwind v3. Compatibility aliases were added so token-backed utility classes from the imported design-system packages can compile during this bridge phase.

Later, decide whether Erve should stay on Tailwind v3 or align with the design system's original Tailwind setup.

## Known Limitation

Full manual browser console and layout verification is still pending because browser automation is not installed in this repo.

## Verification

The following verification commands passed after the migration:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @erve/api exec vitest run
pnpm --filter @erve/api prisma:seed
pnpm --filter @erve/api prisma:seed
```

API tests and seed verification required local PostgreSQL access. The Job Order Planning module was verified after applying `20260630090000_add_job_orders` with `prisma migrate deploy`.
