# @erve/primitives

## Purpose

Provides low-level accessible primitive wrappers used by platform components and patterns.

## What Belongs Here

- `AppButton`, `AppTextField`, select, checkbox, menu, dialog, tooltip, toast, and badge wrappers.
- Primitive-level accessibility and theme behavior.

## What Does Not Belong Here

- ERP transaction behavior.
- Workflow decisions.
- Business validation.
- Client-specific labels or permissions.

## Allowed Dependencies

- `@erve/tokens`.
- Approved third-party primitive or accessibility foundations in the future.

## Examples of Future Exports

- `AppButton`
- `AppTextField`
- `AppDialog`

Theme is owned by `@erve/theme`; primitives consume its CSS variables but do not export a theme provider.
