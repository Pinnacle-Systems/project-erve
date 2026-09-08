# Order Sheet (PO) and job-order operational API contract

Shared public contracts live in `@erve/types` (`operations.ts`). Prisma types
are internal and are not exported as API contracts.

`GET /purchase-orders` and `GET /job-orders` return
`{ items, pageInfo: { limit, hasMore, nextCursor } }`. Pass `cursor` and
`limit` with the existing server-side filters. Ordering uses immutable ULIDs,
so cursors remain stable while records are updated.

`GET /job-orders/assigned-tasks` is FACTORY_USER-only, requires exactly one
factory mapping, excludes unsent drafts, and returns compact task summaries.
Detail, audit, and mutation routes independently re-check resource access.

Every JO response carries integer `version`. Send, confirm, complete-stage,
and prepared-quantity bodies require `expectedVersion`. Success increments the
version; stale requests receive HTTP 409 `STALE_VERSION` with the current
version in details.

Those mutations also require `Idempotency-Key`. Keys are scoped to actor and
operation. The API stores the entity, request SHA-256, and result version in
the same transaction as mutation and audit. Repeating a key and payload
returns success without reapplying either. Reuse for another payload or entity
returns `IDEMPOTENCY_KEY_REUSED`. Prepared quantities are absolute values.

An Order Sheet (business terminology for `DistributorPurchaseOrder`, prefix
`EIOS`) is exactly one Style with size-wise forecast quantities, one
Distributor, and no Submit/Review/Approve workflow — it is immediately
eligible for Job Order planning the moment it's created. `purchaseMode` is
derived server-side from the Distributor's own (locked) `purchaseMode`, never
client-supplied.

Order Sheet Phase 2: one Job Order consolidates one or more source Order
Sheets — always the same Style, optionally different Distributors/Purchase
Modes (`DistributorPurchaseOrder.jobOrderId` / `JobOrder.orderSheets` is the
sole authoritative relationship; `JobOrder.purchaseOrderId` no longer
exists). Creating a Job Order claims every selected Order Sheet atomically
via one conditional `updateMany` on `DistributorPurchaseOrder.jobOrderId`
(`WHERE id IN (...) AND jobOrderId IS NULL`; a short count mismatch rolls
back the whole transaction and returns 409). Once claimed, each Order Sheet
is locked (uneditable, uncancellable, unselectable by another Job Order) for
as long as the mapping exists. `DistributorPurchaseOrder.jobOrderId` is
`ON DELETE RESTRICT` (not `SET NULL`) — Job Orders have no hard-delete path
in application code, so a future accidental one now fails loudly instead of
silently releasing frozen planning provenance.

**Order Sheet Phase 2.1 — Job Order Production Plan / QA-Pooled Inventory
decoupling.** Order Sheets are planning provenance only; they never own the
Job Order's production quantities or its QA-passed inventory:

- `POST /job-orders` accepts `{orderSheetIds: [...], sizes: [{sizeId,
  quantity}], factoryId, processFlowVersionId, unitPrice, disclaimerText?,
  requiredDeliveryDate?}` — ONE flat production plan for the whole Job
  Order, entirely independent of any source Order Sheet's own forecast (no
  per-source quantity, no per-source `JobOrderLine`). `sizes[].sizeId` is
  validated against the shared Style's own canonical valid-size set
  (`StyleSize` + `Size` both `ACTIVE` — `getActiveStyleSizeIds`, shared with
  Order Sheet line validation), not against any source's forecast sizes; at
  least one entry must have `quantity > 0` and the plan total must be `> 0`.
  `JobOrderLine`/`JobOrderLineSize` are correspondingly now exactly one line
  per Job Order and one size row per line+size — no `purchaseOrderLineId`/
  `purchaseOrderLineSizeId` FK exists on either anymore.
- `PATCH /job-orders/:id/sources` (`{expectedVersion, add: [orderSheetId,
  ...], remove: [orderSheetId, ...]}`) is DRAFT-only, pure planning-
  provenance mutation — `add`/`remove` are bare Order Sheet id lists (no
  quantities). It only ever mutates `DistributorPurchaseOrder.jobOrderId`;
  it never creates, deletes, or otherwise touches the Job Order's own
  `JobOrderLine`/`JobOrderLineSize` production plan. At least one source
  must remain; an added source must share the Job Order's own (already
  fixed) Style. The mapping freezes permanently once the Job Order reaches
  `SENT_TO_FACTORY`.
- `PATCH /job-orders/:id/production-plan` (`{expectedVersion, sizes:
  [{sizeId, quantity}]}`) is DRAFT-only and is the sole way to change the
  Job Order's own production-plan quantities once created — source changes
  never do. It fully replaces the size set each call, with one carve-out:
  an existing size whose `StyleSize` mapping has since been removed or
  deactivated is preserved unchanged if omitted, accepted as a no-op if
  resubmitted with the same quantity, and rejected if resubmitted with a
  different quantity (never silently applied or dropped). Records
  `JOB_ORDER_PRODUCTION_PLAN_UPDATED` audit with `{before, after}` per-size
  snapshots — never a per-Order-Sheet breakdown.

`JobOrder.requiredDeliveryDate` is the Job Order's own delivery target date
(independent of any source's `requiredDeliveryDate`) — editable via `PATCH
/job-orders/:id/delivery-date` until `factoryConfirmationStatus` reaches
`CONFIRMED` (a separate, later lifecycle point from the source-mapping
freeze).

Order Sheet provenance (`sourceOrderSheets`, `combinedForecast`) is
Merchandising planning information only — `toJobOrderView`'s
`includeSourceOrderSheets` option omits it entirely for FACTORY_USER/
QA_USER viewers, who identify work by Job Order Number/Style/Factory only.
Every viewer still gets a bare `sourceOrderSheetCount`. `combinedForecast`
sums each source's own forecast per size and is purely informational — it
never constrains or resets the Production Plan.

**QA-passed pooled inventory.** Final-QA-passed stock is dispatch-
allocatable pooled inventory keyed by **Factory + Style + Size** only —
never by Distributor, Order Sheet, or Purchase Mode — computed via
`getPooledFactoryInventory` (`apps/api/src/modules/job-orders/
pooled-inventory.service.ts`, exposed at `GET /job-orders/pooled-inventory`)
purely from `QaReleaseLine.jobOrderLineSizeId -> JobOrderLineSize ->
JobOrderLine -> JobOrder` (factory, style) + `JobOrderLineSize.sizeId`,
minus `StockAllocation` (`ACTIVE`) committed quantity. This correctly pools
across every contributing Job Order regardless of source-Order-Sheet count.

`QaReleaseLine.purchaseOrderLineSizeId` is now **nullable** and is an
isolated **legacy Sale Order compatibility bridge only** — it does not mean
ownership. `quality-executions.service.ts`'s
`resolveLegacyPurchaseOrderLineSizeIds` populates it for a produced size
only when **both**: (A) the releasing Job Order has exactly one source
Order Sheet, and (B) that source has a matching `DistributorPurchaseOrderLineSize`
for the produced size. Otherwise it is `null`, and no
`DistributorPurchaseOrderLineSize.qaPassedQuantity` is incremented. The
existing (pre-pooled-inventory) Sale Order allocation workflow
(`sale-orders.service.ts` `submitSaleOrder`/`approveSaleOrder`) matches
`SaleOrderLine.purchaseOrderLineSizeId` to this field by strict equality —
a `null` bridge value is therefore automatically and correctly excluded
from Sale Order availability, with no code change needed there. **This
means pooled-only QA-passed stock (any multi-source Job Order's output, or
a single-source Job Order's output for a size its one source never
forecast) is not yet allocatable through the legacy Sale Order workflow —
only through the pooled-inventory read path above.** Do not enable
workflows in production that expect such stock to flow through the current
Sale Order path before the Dispatch Order redesign (next phase) implements
true pooled allocation.

PO/JO numbering still holds a transaction-scoped PostgreSQL advisory lock per
type/year until insertion; unique indexes remain the final invariant.
Hardened mutations and their audit records commit or roll back together.

The QA extension and its explicit assumptions are documented in
[`docs/QA_WORKFLOW.md`](../../docs/QA_WORKFLOW.md). `QA_APPROVED` replaces the
legacy placeholder pass statuses for new workflow actions.
