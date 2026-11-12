# ISS-089: Store-level FIFO Sales and Returns (+ ISS-092)

Base: `ee98819fc8b41514aa4d6ad0ad47a5472e8501c2` (`origin/main`). Branch: `feat/store-level-fifo-sales-returns`.

Extends the A6 screen `/fulfillment/retail-store-inventory`. For eligible **SALE_RETURN** stock a **Distributor** can **Report sold** or **Request return** for a Retail Store x Style x Size, quantity and date. The Distributor never selects a Dispatch: the API allocates the quantity across the original `(erveDispatchId, saleOrderLineId)` positions, oldest verified receipt first, and posts ordinary `DistributorSalesReportLine` / `DistributorReturnLine` rows (one per source). No second ledger, no synthetic Dispatch. Because the lines are the existing records, the Dispatch-linked workflows, the Sale-or-Return position and the A6 grid all reflect store-level postings automatically.

FIFO is a source-allocation convention. It is not evidence of which physical garment was sold.

## API (Distributor only; pinned to the caller's own Distributor)

| Endpoint | Purpose |
| --- | --- |
| `GET /retail-store-inventory/store-fifo/availability?storeKey&styleId&sizeId&date` | What a sale / return can allocate on `date`, plus units excluded (received after the date, unverifiable receipt). |
| `POST /retail-store-inventory/store-fifo/sales-reports` | Body `{storeKey, styleId, sizeId, quantity, reportDate, remarks?}`. Header `Idempotency-Key` (8-200 chars). 201 created / 200 replay. |
| `POST /retail-store-inventory/store-fifo/returns` | Same plus required `returnReason`, `returnDate`. |

Role: `RETAIL_STORE_FIFO_ACTION_ROLES = ['DISTRIBUTOR']` (ADMIN is deliberately not included: the allocation is always against the authenticated Distributor's own Stores; internal roles keep the Dispatch-linked flows). A user also holding FACTORY_USER / TRANSPORTER is denied.

## Allocation rules

- Candidates: ledger-backed positions (`ErveDispatchDeliveryLine.receivedQuantity > 0`) of that Distributor's exact Retail Store, Style, Size and SALE_RETURN mode. Distributor and Store scoping is in SQL, so another Distributor's Store yields "no confirmed received stock" and nothing else.
- **Verified receipt timestamp** = `ErveDispatch.deliveredAt`, only when the Dispatch is `DELIVERED` and `deliveryConfirmationSource` is `USER_CONFIRMED` or `DISTRIBUTOR_CONFIRMED`. `LEGACY_ASSUMED_FULL_RECEIPT`, a null timestamp or a null source is **never** assumed to have a date: those positions are ineligible and reported as "unverified" (`unverifiedReceiptUnits`).
- **Date rule:** a position is eligible when the India (IST) calendar date of its receipt is on or before the sale/return date. Future dates are rejected. Quantities are otherwise taken from current authoritative availability, not a historical as-of balance.
- Order: `deliveredAt`, then Dispatch number, Dispatch id, Sale Order line id.
- Per-position limits come from the shared `computeAvailability()`: `availableForActualSale` for a sale, `availableForNewReturn` for a return. Pending and approved returns, physically received returns and existing sales are therefore respected exactly as in the Dispatch-linked flows (including the existing semantic that a *pending* return reserves only against further returns, an *approved* return also against sales).
- `storeKey` must be `S:<retailStoreId>`. Unmapped historical destinations (`D:...`) are rejected until reconciled. OUTRIGHT stock is rejected with its own message.
- A request above the total eligible quantity is rejected before anything is written.

## Transaction safety

Inside one write transaction: idempotency lock -> cell lock (`store-fifo-<distributor>:<store>:<style>:<size>`) -> candidates loaded **in the transaction** (the `/sources` response is never trusted) -> the existing `saleOrReturnPositionLockKey` advisory locks, sorted, so lock order is compatible with the Dispatch-linked mutations -> candidate set re-read; if it changed the attempt is rolled back and retried (max 3, then 409) -> quantities re-read after the locks -> allocate -> create the Sales Report / Return, lines and audit row. The audit entry records the store-level request and the source allocations.

## Idempotency (the only schema change)

Migration `20261111000000_store_level_fifo_idempotency`: nullable `idempotency_key` + `request_digest` on `distributor_sales_reports` and `distributor_returns`, with a unique index on `(distributor_id, idempotency_key)`. Existing rows keep NULL (NULLs never collide), so existing data and flows are untouched. Same key + same payload + same user replays the stored document (200, `replayed: true`); same key with a different payload, a different user, or on the other action kind is a 409.

## Web

For a Distributor, Sale-or-Return Style cards of **mapped** Stores get an "Actions" row (Sold / Return per Size that has a position; disabled when nothing is available). The dialog shows Store, Style, Size, available quantity for the chosen date and any excluded stock, keeps entered values on validation/server errors, reuses one Idempotency-Key for safe retries (changing a field starts a new request) and confirms with the per-Dispatch allocation and a link to the Sales Report / Return.

## ISS-092

`DistributorSalesReportDetailPage` read `report.submittedAt`; the API returned `createdAt`. The API view now returns `submittedAt` (matching `DistributorSalesReportView` and the Distributor Return view) and no longer returns `createdAt`; the page also renders "—" instead of "Invalid Date" for a missing timestamp. No migration: `submitted_at` already exists on every row.

## Verification

- API (disposable PostgreSQL): `retail-store-fifo.test.ts` (15 scenarios), `retail-store-fifo-allocation.unit.test.ts`. `distributor-sales-report.test.ts` also passes locally; the other existing post-dispatch suites (Return, A6 inventory, Sale-or-Return position, A4 receipt, delivery) are left to the PR's CI run.
- Web: `StoreFifoActions.test.tsx`, `DistributorSalesReportDetailPage.test.tsx`, `RetailStoreInventory.test.tsx`.
- Browser (`tools/store-level-fifo/browser.mjs`, guarded to a local `fifo_browser_test` database): Distributor sale + return flows and Sales Report detail at 1440px and 375px, no page overflow; Admin sees no actions.

## Known limitations

- Not available for Admin / internal roles, Outright stock, or unmapped historical destinations.
- Legacy-assumed receipts stay ineligible until they receive verified evidence; there is no stock-adjustment path (out of scope).
- Pending returns do not reserve against *Actual Sale* until approved (pre-existing rule); a racing sale + return mix can therefore both succeed up to current rules.
- Availability shown in the grid cell (A6) includes legacy-receipt stock; the dialog's number is the eligible figure and explains the difference.

## Observed in the AW26 run (2026-11-12)

- Dates are India time. A receipt made at 05:20 IST on the 12th (still the 11th in UTC) is refused for a sale dated the 11th ("no stock received on or before").
- With 2 pieces from an older dispatch and 1 from a later one, selling 2 drew only on the older; selling 2 more was refused (1 left); the last 1 drew on the later dispatch.
- Same Idempotency-Key and payload replays (200); same key with another payload returns 409; a future date, Outright stock, Admin and another Distributor's Store are all refused.
