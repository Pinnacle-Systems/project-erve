# Sale-or-Return Stock — Style-first consolidated reporting

Base: `77111c4` (`origin/main`). Branch: `feat/sale-or-return-style-consolidated-stock`. Read-only; no schema change, no migration, no new ledger.

## Problem

`/fulfillment/sale-or-return` showed one Style × Size block **per Dispatch / Order**, so a Style appearing in 100 Dispatches appeared 100 times and its own stock position was hard to see. It also fetched only the first 25 source positions, so any browser-side grouping would have produced incomplete totals.

## Presentation hierarchy

| Level | Screen | Request (all read-only) |
|---|---|---|
| 1 | One row per Style, consolidated across every Dispatch, Distributor and Store in scope | `GET /sale-or-return-stock/styles` |
| 2 | Style detail: one native Style × Size matrix | `GET /sale-or-return-stock/styles/:styleId` |
| 3 | Distributor-wise totals; Retail Stores opened per Distributor | same response (Distributors); `GET …/stores?distributorId=` on demand |
| 4 | Paginated contributing Dispatches / Sale Orders for reconciliation | `GET …/sources` (filter by Distributor, Store, Size) |

Each level is its own bounded request; the Store and Dispatch levels load only when opened. No level loads historical transactions into the browser to total them.

Routes: `/fulfillment/sale-or-return` (Level 1), `/fulfillment/sale-or-return/styles/:styleId` (Levels 2–4), `/fulfillment/sale-or-return/by-dispatch` (the original Dispatch-by-Dispatch screen, kept — see below).

## Read model (decision: dedicated endpoints over the A6 `pair_components` CTE)

The existing Distributor × Style aggregate (`getSaleOrReturnGroupedTotals`) has no Size, Store, receipt evidence or pagination, and `listSaleOrReturnPositionsPage` pages source positions, not Styles. The A6 Retail Store Inventory query already produces, in PostgreSQL, exactly the grain this needs — one row per `(erveDispatchId, saleOrderLineId)` with stable Style / Size / Distributor / Retail Store identities, purchase mode, the A4 Distributor receipt (NULL when absent), the received ledger in use, and the Sales Report / Return components. So:

- `sale-or-return-stock-query.ts` re-groups that CTE (`pairComponentsCte`, `SUMS_SQL`, now exported from `retail-store-inventory-query.ts`) by Style, Size, Distributor and Store. It derives no quantity itself.
- `sale-or-return-stock.service.ts` owns authorization, Distributor scoping, pagination and shaping. Availability is finalized by the one shared `computeAvailability()` via `toMeasures()`. That formula is linear, so applying it to summed components equals summing the per-source availabilities; this is asserted against the existing `/sale-or-return-positions` endpoint.
- `sale-or-return-stock.routes.ts` is mounted at `/sale-or-return-stock` with `SALE_OR_RETURN_POSITION_VIEW_ROLES`.
- The only change to A6 code: `pairComponentsCte` / `SUMS_SQL` are exported; the A6 source-row mapper is extracted as `toInventorySource` (unchanged mapping); the A6 source query also returns the Distributor code/name.

Required properties:

1. Aggregation is in PostgreSQL over the whole qualifying history.
2. Style pagination is keyset on aggregated Styles `(lower(style number), style id)`; the response carries whole-result `summary` totals independent of the page.
3. Totals are complete at 100+ Dispatches (test: one Style across 120 Dispatches).
4. The Distributor scope is enforced in the service: a DISTRIBUTOR is pinned to its own Distributor and a different `distributorId` is `403`.
5. Identities are stable ids: Style id, Distributor id, Retail Store key (`S:<retailStoreId>`; an unmapped historical destination is its own `D:<destinationId>` group, never merged by name).
6. Every source row keeps its original `(erveDispatchId, saleOrderLineId)`.
7. `purchaseMode` is pinned to `SALE_RETURN` in the query builder, so OUTRIGHT stock can never enter a consignment balance.
8. Receipt, sold, return and reservation semantics are the existing ones (same CTE).
9. Statement count is constant as data grows (test: identical at 1 and 120 Dispatches); no per-position follow-up queries.
10. No stock table and no write path; there are no mutation routes.

## Measures

Dispatched, received ledger, Distributor-attested receipt (separate evidence), awaiting Distributor receipt, actual sold, returned to Erve (physically received), pending return requests, **approved returns awaiting receipt**, remaining with Distributor, available for actual sale, available for new return.

- The ambiguous label **Awaiting Receipt** is renamed **Approved Returns Awaiting Receipt** (also on the per-Dispatch screen). It means approved Distributor Returns not yet physically received by Erve — never incoming dispatch delivery.
- `null` means "no evidence recorded" and shows as `n/r` / "Not recorded". It is never rendered as 0. Remaining/availability still compute from a missing ledger as 0 (existing behavior), but the ledger and attested figures stay `null`.
- "Awaiting Distributor receipt" is dispatched quantity with no Distributor receipt yet — not "in transit".

## Roles

| Role | Behavior |
|---|---|
| MERCHANDISER | All Distributors consolidated by default; optional Distributor filter (URL `?distributorId=`); Style search; Distributor-wise breakdown per Style; clearing the filter returns to all-Distributor totals |
| ADMIN | Same read visibility and filter. The transactional rules are unchanged: the per-Dispatch screen still requires choosing a Distributor before Report Sold / Request Return |
| SENIOR_MANAGEMENT | Consolidated read; Distributor filter; no mutation |
| ACCOUNTANT | Consolidated read of every Distributor; no Distributor filter (no Distributor lookup access, as in Retail Store Inventory); no mutation |
| DISTRIBUTOR | Always its own Distributor, server-side; no selector; only Styles of its own qualifying stock; a Style it has no stock in is a uniform `404` (stores/sources: empty) so nothing about another Distributor is revealed |
| FACTORY_USER, TRANSPORTER and others | Refused (`403`), as for Retail Store Inventory |

Style images use the existing policy (`canReadAnyStyleImage`, plus DISTRIBUTOR pinned to its own Distributor).

## Transactions

Nothing transactional moved. The consolidated screens are read-only.

- **Report Sold / Request Return by Dispatch** stays on `/fulfillment/sale-or-return/by-dispatch` (the previous page, unchanged apart from the renamed label and a "Consolidated by Style" link), offered by a button on the new page to users who can submit; other roles get a read-only "Dispatch-wise positions" link.
- **Store-level Report Sold / Request Return** (FIFO) stays on Retail Store Inventory and is linked from the new page for Distributors. No new automatic allocation and no change to FIFO.
- `ErveDispatchDetailPage` still links to `/fulfillment/sale-or-return?distributorId=…`, which is now the consolidated view for that Distributor.

## Verification

- API (`sale-or-return-stock.test.ts`, disposable PostgreSQL, real Packing → Dispatch → receipt → Sales Report / Return flow): consolidation across Distributors and Dispatches; OUTRIGHT excluded; Distributor filter and clearing it; equality with the sum of the existing `/sale-or-return-positions` endpoint across page boundaries; Style pagination and search; missing evidence vs zero; native Size matrix; Distributor and Store breakdown (including an unmapped destination); Dispatch-level attribution and pagination; pending / approved / received returns; role matrix; Distributor isolation (no other Distributor's ids, names, Stores or Styles in any response); image metadata; no mutation routes; one Style across 120 Dispatches (five pages of the existing list, one Style row here) with flat SQL volume.
- Web (`SaleOrReturnStock.test.tsx`): per-role controls and requests, Distributor filter from the URL and clearing, stale id handling, search and Load more, `n/r` rendering, native Size matrix, lazy Store loading, drilldown filters, Dispatch table pagination, scroll containers, empty / error / not-found states.
- Real browser (`tools/sale-or-return-stock/browser.mjs`: headless Chrome against a disposable, guarded `sor_stock_browser_test` database with synthetic data; Distributor A, Accountant, Merchandiser and Admin at 1440 px and 375 px): one consolidated row per Style; role-correct visibility and Distributor filter; clearing the filter restores totals; Outright stock excluded; native Size order; Distributor sections and lazy Store rows; Dispatch table paging (25, then Load more to 33/34); Size drill-down and clearing; the per-Dispatch screen and its renamed label; zero page overflow on every screen and role at both widths (wide tables scroll inside their own container); Distributor A refused (`403`) for Distributor B and nothing of B in A's responses. Evidence (screenshots, `results.json`) is written outside the repository.
- Full API and web suites, typecheck, lint and build run in CI. Local: typecheck, lint, build, the new API suite (23) and the new + legacy web tests (45) pass.

## UAT guide additions (apply to the AW26 post-dispatch UAT guide once PR #218 merges)

That guide exists only on the unmerged #218 branch, so it is not edited here.

> **Sale-or-Return Stock.** Open *Sale-or-Return Stock*. You see one card per Style with its Dispatched, Received ledger, Sold, Returned, Remaining and Available-to-sell quantities, across all Dispatches. Merchandisers, Admins and Senior Management can pick one Distributor to narrow it, and clear it to see everyone again. A Distributor sees only its own stock.
> Open a Style to see its sizes in one table, then each Distributor (open *Show stores* for its Retail Stores) and, at the bottom, the Dispatches behind the numbers. Click a size, Distributor or Store, or choose *Show dispatches*, to list only those Dispatches.
> **n/r** means *not recorded* — nothing has been entered yet. It is not zero. *Distributor-attested receipt* is what the Distributor said it received; *Received ledger* is the quantity Erve uses for sales and returns. They can differ.
> **Approved returns awaiting receipt** are returns that were approved but not yet physically received by Erve. They are not goods on their way to the Distributor.
> To report sold or request a return by Dispatch, use *Report Sold / Request Return by Dispatch* on this page.
