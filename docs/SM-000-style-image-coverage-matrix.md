# Style & Masters Workstream (SM-000) — Style Image Coverage Matrix

Authoritative checklist for where a Style's Primary Style Image must appear, produced by PR1 (shared
primitives) and executed by PR3 (visual identity rollout) and PR4 (Dispatch Order). Built with:

- `apps/web/src/components/style/StyleThumbnailCell.tsx` — clickable thumbnail, opens the shared viewer.
- `apps/web/src/components/style/StyleImageViewer.tsx` + `@erve/app-components`'s `ImageViewerDialog` — zoom/pan/gallery.
- `@erve/app-components`'s `PageHeader` `leadingVisual` prop — single-Style detail-page identity headers.
- `apps/web/src/lib/pdf/core/PdfThumbnail.tsx` — single-Style PDF headers (already proven in `StyleDetailDocument`).
- `apps/web/src/components/style-size-grid/StyleSizeGrid.tsx` — row identity cell for any screen adopting the shared grid.

A thumbnail inside a line-item table row does **not** satisfy a "detail header" requirement — those are
tracked separately below.

## Table/list rows (thumbnail beside Style Number)

| Screen | Status | Notes |
|---|---|---|
| Style Master list (`StyleListPage`) | Done (PR1) | Pre-existing, now via the promoted shared component. |
| Style lookup results (`StyleLookupField`) | PR3 | Add thumbnail to each result row. |
| Order Sheet rows/detail (purchase-orders) | PR3 | Via `StyleSizeGrid` row identity once adopted (single-row instance). |
| Job Order rows/detail | PR3 | Via `StyleSizeGrid` row identity once `JobOrderCreatePage`/`JobOrderProductionTab` adopt it. |
| Dispatch Order rows/selected Styles | PR3/PR4 | Via `StyleSizeGrid` `computed` variant once the equal-distribution flow lands. |
| QA/production screens (single-Style subject) | PR3 | Thumbnail only — existing inspection/defect-evidence UI is preserved, not grid-forced. |
| Factory Packing List / carton contents | PR3 | Identity-appropriate placement, not forced into dense financial tables; carton/packing identity model preserved. |
| Factory inventory screens | PR3 | Thumbnail where Style is listed. |
| Multi-Style financial/summary tables with no single identifiable Style per row | N/A | No image added — density preserved by design. |

## Single-Style detail-*page* headers (prominent, in the page's own identity/header section)

| Screen | Status | Notes |
|---|---|---|
| Style Master Detail (`StyleDetailPage`) | Done (PR1) | `PageHeader` `leadingVisual`, 120px, click-through to viewer. |
| Order Sheet Detail (purchase-orders detail page) | PR3 | Same `leadingVisual` pattern. File confirmed at implementation time. |
| Job Order Detail (job-order-detail shell) | PR3 | Uses `resolveJobOrderPrimaryStyle` (see below) — never guesses if lines disagree on Style. |
| Applicable single-Style QA/production detail screens | PR3 | Scoped to screens whose primary record is one Job Order/Style. |

## Single-Style PDF headers (primary-image header, classified by business entity)

| Document | Status | Notes |
|---|---|---|
| `StyleDetailDocument` / `StyleListDocument` | Done | Pre-existing; the proven pattern (`PdfThumbnail`) everything else follows. |
| `OrderSheetDetailDocument` | PR3 | One Order Sheet = one Style. |
| `JobOrderDetailDocument` | PR3 | One Job Order = one Style — via `resolveJobOrderPrimaryStyle`. |
| `PpSampleDocument` / `QualityExecutionDocument` (scoped to one Job Order) | PR3 | Same resolver reused, not re-implemented. |
| `InvoiceHandoffDetailDocument` | PR3 | Already confirmed singular-Style view-model. |
| `DispatchOrderDetailDocument`/List, `FactoryPackingListDetailDocument`, `CartonLabelDocument`, `FactoryInvoiceDetailDocument`, `PackingAuditCartonDetailDocument` | N/A | Genuinely multi-Style by business design — out of scope for a header image, existing density/pagination preserved. |

## Job Order single-Style invariant

A Job Order's primary Style is resolved through one shared function — `resolveJobOrderPrimaryStyle(jobOrder)`
— used by both `JobOrderDetailDocument` and the Job Order detail-page header (written once, not duplicated
per call site). It confirms every `JobOrderLine` on the Job Order shares the same `styleId` before resolving
an image. Lines may legitimately differ by Size/allocation, never by Style. If legacy data violates that
invariant, the resolver returns an explicit "inconsistent" result — the header/PDF renders the existing
honest missing-image fallback instead of guessing, and the inconsistency is logged. The underlying
`JobOrderLine` data is never modified to force consistency.
