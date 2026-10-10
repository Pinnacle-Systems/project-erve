# Style & Masters Workstream (SM-000) — Style Image Coverage Matrix

Authoritative checklist for where a Style's Primary Style Image must appear, produced by PR1 (shared
primitives) and executed by PR3 (visual identity rollout) and PR4 (Dispatch Order). Built with:

- `apps/web/src/components/style/StyleThumbnailCell.tsx` — clickable thumbnail, opens the shared viewer.
- `apps/web/src/components/style/StyleImageViewer.tsx` + `@erve/app-components`'s `ImageViewerDialog` — zoom/pan/gallery.
- `@erve/app-components`'s `PageHeader` `leadingVisual` prop — single-Style detail-page identity headers.
- `apps/web/src/lib/pdf/core/PdfThumbnail.tsx` — single-Style PDF headers (already proven in `StyleDetailDocument`).
- `apps/web/src/components/style-size-grid/StyleSizeGrid.tsx` — row identity cell for any screen adopting the shared grid.
- `apps/web/src/pages/job-orders/resolveJobOrderPrimaryStyle.ts` — the Job Order single-Style invariant, shared by screen and PDF.

A thumbnail inside a line-item table row does **not** satisfy a "detail header" requirement — those are
tracked separately below.

**Real gap found during PR3 implementation (not anticipated by the PR1 plan):** no Style-bearing view
(`PurchaseOrderLine`, `JobOrderLine`, the Order Sheet Style lookup option, `InvoiceHandoffView.style`) carried
image data at all — `StyleThumbnailCell` requires a resolved `StyleImage` object, not just a `styleId`. Each
row below that shipped in PR3 required adding a `primaryImage` field end-to-end (Prisma query → API view
shape → `@erve/types` → web consumer), reusing the Style master's own primary-image selection (`isPrimary`
desc, `sortOrder` asc) via a new shared `toPrimaryImageView`/`stylePrimaryImageInclude` helper
(`apps/api/src/modules/master-data/style-images.service.ts`) rather than re-deriving it per module.

## Table/list rows (thumbnail beside Style Number)

| Screen | Status | Notes |
|---|---|---|
| Style Master list (`StyleListPage`) | Done (PR1) | Pre-existing, now via the promoted shared component. |
| Style lookup results (`StyleLookupField`) | **Done (PR3)** | `OrderSheetStyleOption.primaryImage` added API-side; thumbnail added to `StyleOptionRow`, non-clickable (a click here selects the option, not opens the viewer). |
| Order Sheet rows (detail page's line panel) | **Done (PR3)** | `PurchaseOrderLine.primaryImage` added; thumbnail added directly to the line's identity block, and via `OrderSheetSizeGrid` (`StyleSizeGrid` wrapper) in the create/edit form. |
| Order Sheet **list** (`PurchaseOrderListPage`) | **Exception — N/A** | The list shows no Style column at all today (not even `styleNumber`), by existing design. Adding one is a layout decision beyond a thumbnail rollout; not done in PR3. |
| Job Order rows (Production Plan) | **Done (PR3)** | Via `JobOrderPlanningGrid` (`StyleSizeGrid` wrapper) adopted in `JobOrderProductionTab`'s editable Production Plan. `JobOrderCreatePage`'s "Combined Forecast vs Production Plan" table keeps its existing 3-metric-per-Size (forecast/plan/variance) `DataTable` shape — `StyleSizeGrid` is one-quantity-per-cell and cannot represent that comparison — but gained a Style identity thumbnail in its own panel title and the NumericField swap (see below). |
| Job Order **list** (`JobOrderListPage`) | **Exception — N/A** | Same reasoning as the Order Sheet list: no Style column today, and a Job Order can legitimately span multiple Styles, so there's no single row-level Style to attach a thumbnail to. |
| Dispatch Order rows/selected Styles | **Deferred to PR4** | PR4 rewrites this exact quantity-entry UI into `StyleSizeGrid`'s `computed` variant for the equal-distribution rule — building thumbnail coverage here now would be re-done immediately. Read-only Dispatch Order list/detail screens were not touched in PR3 either, for the same reason: PR4 owns this screen's identity work as one piece. |
| QA/production screens (single-Style subject) | **Deferred — exception** | `QaInspectionDetail.lines[]` (and `QualityExecutionView`) carry `styleNumber`/`styleName` only, no `styleId` — unlike PO/JO lines, there's no single relation to extend; the Style reference is nested through `JobOrderLineSize → JobOrderLine → Style` at 3+ separate call sites in `qa.service.ts`. Flagged for a follow-up, not implemented in this PR. |
| Factory Packing List / carton contents (`PackingAuditCartonDetailPage`) | **Deferred — exception** | Same gap: its Style column (`r.styleNumber`/`r.styleName`) has no `styleId` to resolve an image from. Follow-up, not implemented in this PR. |
| Factory inventory screens | **N/A — doesn't exist** | No screen under this name (or an obvious synonym) exists in the app today; nothing to wire. Flagging for whoever scoped this item in case a future screen is planned. |
| Multi-Style financial/summary tables with no single identifiable Style per row | N/A | No image added — density preserved by design. |

## Single-Style detail-*page* headers (prominent, in the page's own identity/header section)

| Screen | Status | Notes |
|---|---|---|
| Style Master Detail (`StyleDetailPage`) | Done (PR1) | `PageHeader` `leadingVisual`, 120px, click-through to viewer. |
| Order Sheet Detail (`PurchaseOrderDetailPage`) | **Done (PR3)** | `PageHeader` `leadingVisual`, 56px, from the Order Sheet's one line (server-enforced exactly one Style per Order Sheet). |
| Job Order Detail (`JobOrderPageHeader`, inside `job-order-detail/`) | **Done (PR3)** | `PageHeader` `leadingVisual`, 56px, gated by `resolveJobOrderPrimaryStyle` — renders nothing (not a guess) when legacy lines disagree on Style. |
| Applicable single-Style QA/production detail screens | **Deferred — exception** | Same data-gap reasoning as the QA table-row item above. |

## Single-Style PDF headers (primary-image header, classified by business entity)

| Document | Status | Notes |
|---|---|---|
| `StyleDetailDocument` / `StyleListDocument` | Done | Pre-existing; the proven pattern (`PdfThumbnail`) everything else follows. |
| `OrderSheetDetailDocument` | **Done (PR3)** | New `prepareOrderSheetDetailPdfData.ts` prepare step (same convention as `prepareStyleDetailPdfData.ts`); 90×90 header image beside the identity key-value section. |
| `JobOrderDetailDocument` | **Done (PR3)** | New `prepareJobOrderDetailPdfData.ts`, gated by `resolveJobOrderPrimaryStyle` — placeholder (never a guess) if lines disagree on Style. |
| `InvoiceHandoffDetailDocument` | **Done (PR3)** | New `prepareInvoiceHandoffDetailPdfData.ts`; `InvoiceHandoffView.style` extended with `id`/`primaryImage` end-to-end (API + shared types). Confirmed singular-Style view-model, as the PR1 plan assumed. |
| `PpSampleDocument` / `QualityExecutionDocument` (scoped to one Job Order) | **Deferred — exception** | Same QA data-gap as above: `QaInspectionDetail`/`QualityExecutionView` have no `styleId` to resolve, and a QA record's Job Order can itself span multiple Styles (same invariant question `resolveJobOrderPrimaryStyle` answers elsewhere) — doing this correctly needs the same plumbing fix as the QA table-row item, not a special case here. |
| `DispatchOrderDetailDocument`/List, `FactoryPackingListDetailDocument`, `CartonLabelDocument`, `FactoryInvoiceDetailDocument`, `PackingAuditCartonDetailDocument` | N/A | Genuinely multi-Style by business design — out of scope for a header image, existing density/pagination preserved. |

## Style×Size grid adoption (SM-005)

| Screen | Status | Notes |
|---|---|---|
| Order Sheet form (`PurchaseOrderFormPage`) | **Done (PR3)** | `OrderSheetSizeGrid` thin wrapper over `StyleSizeGrid` (`editable`), replacing the bespoke per-size `TextField` grid. Gets the Style thumbnail and NumericField validation "for free" through the shared engine. |
| Job Order Production Plan (`JobOrderProductionTab`) | **Done (PR3)** | `JobOrderPlanningGrid` thin wrapper. An inactive (non-producible) Size still displays — `StyleSizeGrid` gained a new `StyleSizeGridColumn.editable` flag (defaults `true`) so a column can be forced read-only across every row without hiding it, matching the bespoke table's existing safeguard. |
| Job Order Create (`JobOrderCreatePage`'s Combined-Forecast-vs-Plan table) | **Exception — kept as `DataTable`** | Three metrics per Size (forecast/plan/variance), not one quantity per cell — `StyleSizeGrid`'s shape doesn't fit. NumericField swapped in directly for the editable cell; a Style identity thumbnail was added to the panel title instead of the row. |
| Dispatch Order (`SaleOrderFormPage`) | **Deferred to PR4** | PR4's own deliverable (the equal-distribution rule) is specifically a `StyleSizeGrid` `computed` variant here — building it now would be redone. |
| QA / carton-packing screens | **Not adopted, by design** | Domain-specific batch/inspection and carton/destination/audit workflows that don't fit the Style×Size shape — per the original plan, never forced onto the generic grid. |

## NumericField adoption (UX-19)

| Site | Status | Notes |
|---|---|---|
| `StyleSizeGrid` editable cells (Order Sheet form, Job Order Production Plan) | **Done (PR3)** | Came for free via the two grid migrations above. |
| `JobOrderCreatePage.tsx` Production Plan quantity (`Math.max(0, Number(x\|\|0))`) | **Done (PR3)** | Replaced with `NumericField mode="integer" min={0}` — out-of-range entry is now a validation error, never a silent clamp. |
| `JobOrderProductionTab.tsx` Production Plan quantity | **Done (PR3)** | Superseded by the `JobOrderPlanningGrid` migration above (same ad hoc clamp pattern, now gone). |
| `StyleFactoryMappingsField.tsx` `exFactoryPrice` | **Done (PR3)** | `NumericField mode="currency" min={0}`. `exFactoryPrice` stays a `string` end-to-end in `StyleFactoryMappingRow`/`style-form-state.ts` (unchanged contract) — the field only converts at its own edge. |
| `PurchaseOrderFormPage.tsx` per-size quantity | **Done (PR3)** | Superseded by the `OrderSheetSizeGrid` migration above. |
| `SaleOrderFormPage.tsx` | **N/A — no ad hoc clamp found** | The actual quantity `<input>` stores the raw string with no inline coercion; `Number(x) \|\| 0` only appears in read-only total/aggregation helpers and the submit-time payload build, which are not user-facing inputs. Its quantity-entry model itself is being replaced by PR4's equal-distribution grid, so left untouched here. |
| Style codes, LMIX numbers, barcodes, phone numbers, carton Net/Gross Weight (free text) | **Excluded, as specified** | Stay on `TextField` — never converted to numeric inputs. |

## Job Order single-Style invariant

A Job Order's primary Style is resolved through one shared function — `resolveJobOrderPrimaryStyle(lines)`
(`apps/web/src/pages/job-orders/resolveJobOrderPrimaryStyle.ts`) — used by both `JobOrderDetailDocument`
(via `prepareJobOrderDetailPdfData.ts`) and the Job Order detail-page header (`JobOrderPageHeader`), so the
invariant check is written once. It confirms every `JobOrderLine` on the Job Order shares the same `styleId`
before resolving an image. Lines may legitimately differ by Size/allocation, never by Style. If legacy data
violates that invariant, the resolver returns `{ consistent: false }` — every caller renders the existing
honest missing-image fallback instead of guessing, and the underlying `JobOrderLine` data is never modified
to force consistency. The resolver itself stays pure (no logging side effect, for testability); each caller
may add its own operational-visibility logging if needed.
