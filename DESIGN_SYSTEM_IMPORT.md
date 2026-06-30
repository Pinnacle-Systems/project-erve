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
- Job-order balance, fulfilment summary, and audit sections remain placeholder panels where backend/module support is incomplete.

## Tailwind Compatibility

The web app remains on Tailwind v3. Compatibility aliases were added so token-backed utility classes from the imported design-system packages can compile during this bridge phase.

Later, decide whether Erve should stay on Tailwind v3 or align with the design system's original Tailwind setup.

## Known Limitation

Full manual browser console and layout verification is still pending because browser automation is not installed in this repo.

## Verification

The following verification commands passed after the migration:

```sh
pnpm -r typecheck
pnpm -r lint
pnpm --filter @erve/web build
pnpm --filter @erve/api test
pnpm --filter @erve/mobile build
```

API tests required local PostgreSQL access. The web shell and API health endpoint were also smoke-checked over HTTP during verification.
