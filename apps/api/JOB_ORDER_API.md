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
exists). `POST /job-orders` accepts `sources: [{orderSheetId, sizes:
[{sizeId, quantity}]}]` instead of a single `purchaseOrderId`. Creating a Job
Order claims every selected Order Sheet atomically via one conditional
`updateMany` on `DistributorPurchaseOrder.jobOrderId` (`WHERE id IN (...) AND
jobOrderId IS NULL`; a short count mismatch rolls back the whole transaction
and returns 409) — Job Order quantities are independent of any source Order
Sheet's forecast (each source's quantities pre-fill as that source's own
forecast, freely editable per size per source, no remaining-balance cap, no
per-Order-Sheet allocation ledger). Once claimed, each Order Sheet is locked
(uneditable, uncancellable, unselectable by another Job Order) for as long as
the mapping exists.

While a Job Order is DRAFT, its source Order Sheet set is itself editable via
`PATCH /job-orders/:id/sources` (`{expectedVersion, add: [...], remove:
[...]}` — same atomic-claim/release semantics, at least one source must
remain, added/removed sources must share the existing Style). The mapping
freezes permanently once the Job Order reaches `SENT_TO_FACTORY`. There is
still no Job-Order-cancellation path that would release a locked mapping.

`JobOrder.requiredDeliveryDate` is the Job Order's own delivery target date
(independent of any source's `requiredDeliveryDate`) — editable via `PATCH
/job-orders/:id/delivery-date` until `factoryConfirmationStatus` reaches
`CONFIRMED` (a separate, later lifecycle point from the source-mapping
freeze).

Order Sheet provenance (`sourceOrderSheets`, `combinedForecast`, each
line's `sourceOrderSheet`) is Merchandising planning information only —
`toJobOrderView`'s `includeSourceOrderSheets` option omits it entirely for
FACTORY_USER/QA_USER viewers, who identify work by Job Order Number/Style/
Factory only. Every viewer still gets a bare `sourceOrderSheetCount`.

PO/JO numbering still holds a transaction-scoped PostgreSQL advisory lock per
type/year until insertion; unique indexes remain the final invariant.
Hardened mutations and their audit records commit or roll back together.

The QA extension and its explicit assumptions are documented in
[`docs/QA_WORKFLOW.md`](../../docs/QA_WORKFLOW.md). `QA_APPROVED` replaces the
legacy placeholder pass statuses for new workflow actions.
