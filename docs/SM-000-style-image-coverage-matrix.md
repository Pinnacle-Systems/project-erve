# Style & Masters Workstream (SM-000) — Style Image Coverage Matrix

Authoritative checklist for where a Style's Primary Style Image must appear, produced by PR1 (shared
primitives) and executed by PR3 (visual identity rollout) and PR4 (Dispatch Order). Built with:

- `apps/web/src/components/style/StyleThumbnailCell.tsx` — clickable thumbnail, opens the shared viewer.
- `apps/web/src/components/style/StyleImageViewer.tsx` + `@erve/app-components`'s `ImageViewerDialog` — zoom/pan/gallery.
- `apps/web/src/components/style/StyleIdentityUnavailable.tsx` — the explicit "identity couldn't be resolved" marker (see Job Order invariant below); never confused with "no photo uploaded yet".
- `apps/web/src/components/style/identity-header-image-size.ts` — the one shared `IDENTITY_HEADER_IMAGE_SIZE` (120px) every detail-page header uses, so a header image is never sized down to a table-thumbnail size by accident.
- `@erve/app-components`'s `PageHeader` `leadingVisual` prop, and `QualityExecutionHeader`'s own matching `leadingVisual` prop (added in PR3) — single-Style detail-page identity headers.
- `apps/web/src/lib/pdf/core/PdfThumbnail.tsx` — single-Style PDF headers (already proven in `StyleDetailDocument`), now with a third explicit `{ inconsistent: true }` state distinct from `{ placeholder: true }`.
- `apps/web/src/components/style-size-grid/StyleSizeGrid.tsx` — row identity cell for any screen adopting the shared grid.
- `apps/web/src/pages/job-orders/resolveJobOrderPrimaryStyle.ts` — the Job Order single-Style invariant, shared by screen and PDF; `apps/api/src/modules/master-data/style-images.service.ts`'s `resolvePrimaryStyleAcrossLines` is its server-side mirror.

A thumbnail inside a line-item table row does **not** satisfy a "detail header" requirement — those are
tracked separately below.

**Real gap found during PR3 implementation (not anticipated by the PR1 plan):** no Style-bearing view
(`PurchaseOrderLine`, `JobOrderLine`, `QaInspectionDetail.lines`, `QaReworkTaskView`,
`QaSizeInspectionFormView`, `FactoryPackingCartonLineView`, `PackingListLineView`, the Order Sheet Style
lookup option, `InvoiceHandoffView.style`) carried image data at all — `StyleThumbnailCell` requires a
resolved `StyleImage` object, not just a `styleId`. Each row below required adding a `primaryImage` field
end-to-end (Prisma query → API view shape → `@erve/types` → web consumer), reusing the Style master's own
primary-image selection (`isPrimary` desc, `sortOrder` asc) via the shared `toPrimaryImageView`/
`stylePrimaryImageInclude` helpers rather than re-deriving it per module. `QualityExecutionView` and
`JobOrderSummary` additionally needed a *resolved single identity* (`primaryStyle`), not a raw `lines[]`
array, since those views have no other reason to carry per-line data to the client — that resolution
reuses the exact same invariant as the Job Order detail header (`resolvePrimaryStyleAcrossLines` /
`resolveJobOrderPrimaryStyle`), never a separate one-off.

**Correction from the PR3 review:** an earlier version of this matrix and some code comments described a
Job Order's multi-line shape as "a Job Order can legitimately span multiple Styles." That was wrong and has
been corrected everywhere. **A Job Order is exactly one Style, server-enforced** on create and on adding a
source Order Sheet (`job-orders.service.ts`: *"All source Order Sheets (and the Job Order) must share one
Style"*) — the same invariant as an Order Sheet. Lines legitimately differ by Size/allocation (one line per
consolidated source Order Sheet), never by Style. `resolveJobOrderPrimaryStyle`'s `consistent: false` branch
exists purely as a **defensive check** against legacy/corrupted data that violates this server-enforced
rule — it is never a legitimate "multi-Style Job Order" case, and every caller must render the explicit
`StyleIdentityUnavailable` (web) / `{ inconsistent: true }` (PDF) marker, never nothing, never a guess at
one line's Style/image.

## Table/list rows (thumbnail beside Style Number)

| Screen | Status | Notes |
|---|---|---|
| Style Master list (`StyleListPage`) | Done (PR1) | Pre-existing, now via the promoted shared component. |
| Style lookup results (`StyleLookupField`) | **Done (PR3)** | `OrderSheetStyleOption.primaryImage` added API-side; each row carries its own separate, accessible preview button (`StyleThumbnailCell`'s own `aria-label="View style image"`, `stopPropagation`'d from the row's own select-on-click) — click-to-select is unchanged. |
| Order Sheet rows (detail page's line panel) | **Done (PR3)** | `PurchaseOrderLine.primaryImage` added; thumbnail on the line's identity block, and via `OrderSheetSizeGrid` (`StyleSizeGrid` wrapper) in the create/edit form. |
| Order Sheet **list** (`PurchaseOrderListPage`) | **Exception — N/A** | The list shows no Style column at all today (not even `styleNumber`), by existing design — an Order Sheet is one Style, but the list's own columns never surfaced it. Adding one is a layout decision beyond a thumbnail rollout; not done in PR3. |
| Job Order rows (Production Plan) | **Done (PR3)** | Via `JobOrderPlanningGrid` (`StyleSizeGrid` wrapper) in `JobOrderProductionTab`'s editable Production Plan. `JobOrderCreatePage`'s "Combined Forecast vs Production Plan" table keeps its existing 3-metric-per-Size (forecast/plan/variance) `DataTable` shape — `StyleSizeGrid` is one-quantity-per-cell and cannot represent that comparison — but gained a Style identity thumbnail in its own panel title and the NumericField swap (see below). |
| Job Order **list** (`JobOrderListPage`) | **Done (PR3)** | New compact "Style" column: `jobOrder.primaryStyle` resolved server-side through the single-Style invariant (`JobOrderSummary.primaryStyle`, shared with the detail header) — thumbnail + Style Number when consistent, `StyleIdentityUnavailable` when a legacy record's lines disagree. |
| QA inspection rows (`QaDetailPage`'s "Quantity reconciliation" table) | **Done (PR3)** | `QaInspectionDetail.lines[]` extended with `styleId`/`primaryImage` (one query-select change in `qa.service.ts`'s `detailInclude`, consumed by all three places that read it: the table rows, `QaReworkTaskView`, and session `QaSizeInspectionFormView` forms). |
| QA selected-Style field (`QaInspectionForm.tsx`'s "Style / colour") | **Done (PR3)** | Thumbnail added inline, from the same `detail.lines[]` entry already resolved for the selected size. |
| Factory Packing List / carton contents (`PackingAuditCartonDetailPage`, `PackingListPage`'s destination-lines table) | **Done (PR3)** | `FactoryPackingCartonLineView`/`PackingListLineView` already had `styleId`; only `primaryImage` was missing. Two call sites in `factory-dispatch.service.ts` extended (`toPackingListCartonView`'s carton lines, and the destination-forecast `linesByDestination` loop) — including two *locally-declared* API-side types (`PackingListCartonView`/`PackingListLineView` in that same file) that duplicate the shared `@erve/types` shapes and had to be kept in sync by hand, a pre-existing pattern worth flagging for cleanup. |
| Dispatch Order rows/selected Styles | **Deferred to PR4** | PR4 rewrites this exact quantity-entry UI into `StyleSizeGrid`'s `computed` variant for the equal-distribution rule — building thumbnail coverage here now would be re-done immediately. Read-only Dispatch Order list/detail screens were not touched in PR3 either, for the same reason: PR4 owns this screen's identity work as one piece. This is **mandatory PR4 acceptance coverage**, not an optional follow-up. |
| Factory inventory screens | **N/A — doesn't exist** | No screen under this name (or an obvious synonym) exists in the app today; nothing to wire. Flagging for whoever scoped this item in case a future screen is planned. |
| Multi-Style financial/summary tables with no single identifiable Style per row | N/A | No image added — density preserved by design. |

## Single-Style detail-*page* headers (prominent, in the page's own identity/header section)

| Screen | Status | Notes |
|---|---|---|
| Style Master Detail (`StyleDetailPage`) | Done (PR1) | `PageHeader` `leadingVisual`, now the shared `IDENTITY_HEADER_IMAGE_SIZE` (120px) constant, click-through to viewer. |
| Order Sheet Detail (`PurchaseOrderDetailPage`) | **Done (PR3)** | `PageHeader` `leadingVisual`, 120px (raised from an initial 56px during review — too close to a table-thumbnail size to read as a header), from the Order Sheet's one line (server-enforced exactly one Style per Order Sheet, never ambiguous). |
| Job Order Detail (`JobOrderPageHeader`, inside `job-order-detail/`) | **Done (PR3)** | `PageHeader` `leadingVisual`, 120px, gated by `resolveJobOrderPrimaryStyle` — shows the explicit `StyleIdentityUnavailable` marker (never nothing) when legacy lines disagree on Style. |
| QA detail screen (`QaDetailPage`, both the PP Sample and the plain-QA header branch) | **Done (PR3)** | `QualityExecutionHeader` gained its own `leadingVisual` prop (same convention as `PageHeader`, added in PR3) for the PP Sample branch; the plain-QA branch already used `PageHeader`. Both resolved through `resolveJobOrderPrimaryStyle(data.lines)` — `QaInspectionDetail.lines` is duck-type compatible with `JobOrderLine`, no separate resolver needed. |
| Quality Execution screen (`QualityExecutionPage`, PPM/Inline/Final) | **Done (PR3)** | New compact identity strip above `QualityExecutionForm` (that shared component itself wasn't modified), using the server-resolved `execution.primaryStyle` — `StyleIdentityUnavailable` when inconsistent. |

## Single-Style PDF headers (primary-image header, classified by business entity)

| Document | Status | Notes |
|---|---|---|
| `StyleDetailDocument` / `StyleListDocument` | Done | Pre-existing; the proven pattern (`PdfThumbnail`) everything else follows. |
| `OrderSheetDetailDocument` | **Done (PR3)** | New `prepareOrderSheetDetailPdfData.ts` prepare step (same convention as `prepareStyleDetailPdfData.ts`); 90×90 header image beside the identity key-value section. |
| `JobOrderDetailDocument` | **Done (PR3)** | New `prepareJobOrderDetailPdfData.ts`, gated by `resolveJobOrderPrimaryStyle` — the explicit `{ inconsistent: true }` marker (not a plain placeholder, not a guess) if lines disagree on Style. |
| `InvoiceHandoffDetailDocument` | **Done (PR3)** | New `prepareInvoiceHandoffDetailPdfData.ts`; `InvoiceHandoffView.style` extended with `id`/`primaryImage` end-to-end. Confirmed singular-Style view-model, as the PR1 plan assumed. |
| `PpSampleDocument` | **Done (PR3)** | New header image in `preparePpSamplePdfData.ts`, reusing `resolveJobOrderPrimaryStyle(detail.lines)` directly (duck-type compatible with `JobOrderLine`) — same invariant, same explicit `{ inconsistent: true }` fallback. |
| `QualityExecutionDocument` | **Done (PR3)** | New header image in `prepareQualityExecutionPdfData.ts`, consuming the API's already-server-resolved `execution.primaryStyle` (no second resolution). |
| `DispatchOrderDetailDocument`/List, `FactoryPackingListDetailDocument`, `CartonLabelDocument`, `FactoryInvoiceDetailDocument`, `PackingAuditCartonDetailDocument` | N/A | Genuinely multi-Style by business design — out of scope for a header image, existing density/pagination preserved. |

## Style×Size grid adoption (SM-005)

| Screen | Status | Notes |
|---|---|---|
| Order Sheet form (`PurchaseOrderFormPage`) | **Done (PR3)** | `OrderSheetSizeGrid` thin wrapper over `StyleSizeGrid` (`editable`), replacing the bespoke per-size `TextField` grid. Gets the Style thumbnail and NumericField validation "for free" through the shared engine. |
| Job Order Production Plan (`JobOrderProductionTab`) | **Done (PR3)** | `JobOrderPlanningGrid` thin wrapper. An inactive (non-producible) Size still displays — `StyleSizeGrid` gained a new `StyleSizeGridColumn.editable` flag (defaults `true`) so a column can be forced read-only across every row without hiding it, matching the bespoke table's existing safeguard. |
| Job Order Create (`JobOrderCreatePage`'s Combined-Forecast-vs-Plan table) | **Exception — kept as `DataTable`** | Three metrics per Size (forecast/plan/variance), not one quantity per cell — `StyleSizeGrid`'s shape doesn't fit. NumericField swapped in directly for the editable cell; a Style identity thumbnail was added to the panel title instead of the row. |
| Dispatch Order (`SaleOrderFormPage`) | **Deferred to PR4 — mandatory acceptance coverage** | PR4's own deliverable (the equal-distribution rule) is specifically a `StyleSizeGrid` `computed` variant here — building it now would be redone. |
| QA / carton-packing screens | **Not adopted, by design** | Domain-specific batch/inspection and carton/destination/audit workflows that don't fit the Style×Size shape — per the original plan, never forced onto the generic grid. They did gain row/field-level thumbnails (see the table above) without adopting the grid itself. |

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

## Job Order single-Style invariant (corrected)

**A Job Order is exactly one Style — server-enforced**, on create and on adding a source Order Sheet (see
*"All source Order Sheets (and the Job Order) must share one Style"* in `job-orders.service.ts`). This is
the same invariant an Order Sheet already has. A Job Order's lines legitimately differ by Size/allocation
(one line per consolidated source Order Sheet), **never** by Style.

The invariant is checked through one shared function on each side:
- Web: `resolveJobOrderPrimaryStyle(lines)` (`apps/web/src/pages/job-orders/resolveJobOrderPrimaryStyle.ts`), consumed by the Job Order detail header, `JobOrderDetailDocument`'s prepare step, `QaDetailPage`'s header (reusing it directly against `QaInspectionDetail.lines`, duck-type compatible), and `PpSampleDocument`'s prepare step.
- API: `resolvePrimaryStyleAcrossLines(lines)` (`apps/api/src/modules/master-data/style-images.service.ts`), used where a view needs to synthesize a single resolved identity server-side instead of shipping raw `lines[]` to the client — `QualityExecutionView.primaryStyle` and `JobOrderSummary.primaryStyle` (the list's new Style column).

Both return the same shape: `{ consistent: true, style }` when every line agrees, `{ consistent: false }`
when they don't (including zero lines). `consistent: false` is a **defensive check against corrupted/legacy
data**, never a legitimate "this Job Order has several Styles" outcome — every caller renders an explicit
**"identity unavailable"** state:
- Web: `StyleIdentityUnavailable` (`apps/web/src/components/style/StyleIdentityUnavailable.tsx`) — a
  labeled, accessible warning marker, visually distinct from `StyleThumbnailCell`'s own "no photo uploaded
  yet" placeholder.
- PDF: `PdfThumbnail`'s `{ inconsistent: true }` state — a bordered amber box with "Image unavailable" text,
  distinct from the plain grey `{ placeholder: true }` box.

Neither path ever silently renders nothing, and the underlying `JobOrderLine` data is never modified to
force consistency. Both resolver functions stay pure (no logging side effect, for testability); a caller may
add its own operational-visibility logging if it needs one.

## Known limitation — jsdom focus/blur fidelity (flagged, not a product bug)

`StyleLookupField`'s per-row preview button relies on a real browser's "mousedown `preventDefault` cancels
the pending focus shift" behavior (the dropdown panel's own `onMouseDown preventDefault`, pre-existing, with
the comment *"Keep focus in the textbox while clicking inside the panel"*) to let a user open the viewer
without the dropdown closing underneath them. jsdom's `.click()` does not model this nuance faithfully (it
unconditionally shifts focus as an internal implementation detail), so the automated test for this
interaction verifies the structural/accessibility guarantee (a separate, labeled, `stopPropagation`'d button
per row — the same mechanism already proven in isolation by `StyleThumbnailCell.test.tsx`) rather than the
full click-without-closing behavior, which needs a real-browser check instead.
