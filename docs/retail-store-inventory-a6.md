# A6 / ISS-088: Retail Store Inventory

Base: `04838ebebba2c843fb58a24818412d7b0ea323b4` (`origin/main`, A5 merged). Branch: `feat/retail-store-inventory`.

A standalone, **read-only, derived** screen at `/fulfillment/retail-store-inventory`. It shows what was physically shipped to each Retail Store across all Erve Dispatches, with Distributor receipt evidence and, for Sale-or-Return only, the consignment position. Hierarchy: **Distributor → Retail Store → Style → that Style's own Size columns**. No migration, no new table, no mutable ledger.

## Source of truth

Grain is the existing authoritative source position `(erveDispatchId, saleOrderLineId)`, aggregated in PostgreSQL.

| Fact | Source |
| --- | --- |
| Shipped | `FactoryPackingCartonLine.quantity` of **non-retired** cartons in an `ErvePackingList` with `status = DISPATCHED` that has its `ErveDispatch` row. Packed-only, OPEN/FINALIZED lists and retired cartons never count. |
| Distributor received | A4 `ErveDispatchDistributorReceiptLine.received_quantity` (the receipt *line* for the source). |
| Received ledger in use | `ErveDispatchDeliveryLine` (what Sales/Returns key off), split by `ErveDispatch.delivery_confirmation_source`. |
| Sold / returned / approved / pending | `DistributorSalesReportLine` and `DistributorReturnLine` by return status (RECEIVED / APPROVED / SUBMITTED), same predicates as `sale-or-return-quantities.ts`. |
| Availability | `computeAvailability()` from `sale-or-return-quantities.ts`, fed the summed components. The formula is linear, so summing then applying equals summing per source. It is never re-derived. |
| Store identity | `SaleOrderDestination.retailStoreId` (stable). |
| Purchase mode | `SaleOrderDistributor.purchaseMode`, kept at source-line level. |
| Style sizes | The Style's own active `StyleSize` rows plus any Size that carries shipments (flagged inactive). Ordered by `Size.sortOrder`, then code. |

### Measure rules

- `null` always means "no evidence", never zero. **Awaiting confirmation** = shipped on Dispatches with no A4 receipt line; it is not "in transit".
- **Shortage** exists only where an A4 receipt line exists: `max(0, shipped − attested)` per source, so opposite differences never cancel.
- A real all-zero A4 attestation is shown as `0` received with a full shortage and no ledger.
- **Ledger in use** is shown separately, split into Distributor-confirmed, Admin/Merchandiser-confirmed, legacy assumed (labelled an assumption, never Distributor-verified) and source-unspecified.
- **Discrepancy** counts sources where an A4 attestation and an earlier ledger both exist and differ (A4 `EVIDENCE_ONLY_EXISTING`, A5 semantics).
- **A3 QR** is shown only in the source drilldown, as carton count confirmed, labelled "physical delivery only". It never changes any quantity.
- **SALE_RETURN** position: Actual sold, Returned, Approved awaiting receipt, Pending requests, Remaining with Distributor, Available for actual sale, Available for new return. A missing ledger counts as 0 received, exactly as the existing position does; reservations are subtracted once, in the existing order.
- **OUTRIGHT**: shipment and receipt evidence only. No sell-through or store on-hand is derived (`saleReturn: null`, "not available").
- The same Style shipped under both modes is two separate cards in a Store.

### Store grouping

Mapped destinations group by the stable Retail Store id, so a renamed Store stays one group; the header shows the current master name while each source keeps its frozen Erve Packing List snapshot. A destination with no `retailStoreId` (pre-ISS-100 history) becomes its own `D:<destinationId>` group labelled **Unmapped historical destination**, showing its original destination snapshot. Stores are never matched or merged by name or address, and Distributors are never combined.

## API (read-only)

- `GET /retail-store-inventory?distributorId&purchaseMode&store&storeKey&style&cursor&limit` — Store groups (limit ≤ 50, default 10), each with Style cards, per-Size cells and subtotals, plus a `summary` over **all** matches (store and dispatch counts, totals by purchase mode).
- `GET /retail-store-inventory/sources?storeKey&styleId&sizeId?&purchaseMode&cursor&limit` — contributing Dispatch / Sale Order lines for a cell (or a whole Style when `sizeId` is omitted), newest first, with the frozen destination snapshots, receipt, ledger and source, QR carton counts, shortage, discrepancy and the SALE_RETURN position.

Scale: filtering, grouping and totals happen in PostgreSQL. Stores are keyset-paginated by `(distributor name, distributor id, store name, store key)` (a total order). A request issues a constant number of statements regardless of Stores, Styles, Sizes or sources; `retail-store-inventory.performance.test.ts` asserts this by counting real SQL at 1 → 15 Stores. List and totals share one repeatable-read snapshot. There is no date filter: a period-only shipped quantity cannot sit beside all-time sales and returns without misleading, so it is left out until its semantics are decided.

## Authorization

`RETAIL_STORE_INVENTORY_VIEW_ROLES` (own role set; `RETAIL_STORE_VIEW_ROLES` is untouched, so the Retail Store master stays closed to Distributors): ADMIN, MERCHANDISER, SENIOR_MANAGEMENT, DISTRIBUTOR, ACCOUNTANT (same audience as the Sale-or-Return position). Holding FACTORY_USER or TRANSPORTER denies access outright, so an extra internal role cannot widen it. TRANSPORTER, FACTORY_USER and QA_USER have no access.

Row level: a user holding DISTRIBUTOR is pinned to the single Distributor they are mapped to (another `distributorId` → 403; an unmapped or multi-mapped user fails closed). Distributor scope is applied inside the SQL of both endpoints, so guessing another Distributor's store key returns nothing. Internal roles may pick a Distributor or leave it open (grouped by Distributor).

**Style images** follow the shared Style image policy of `style-images.service.ts` (PR #214, IMG-25): ADMIN / MERCHANDISER / SENIOR_MANAGEMENT / ACCOUNTANT receive `primaryImage` for any inventory they may view, and a DISTRIBUTOR receives it for its own inventory. A Distributor is pinned to its own Distributor in SQL and the inventory is built only from that Distributor's dispatched cartons, so every Style it sees is one `distributorHasStyleAssociation` accepts on `GET /styles/:id/images` and `/images/:imageId/content`: the thumbnail, the viewer's gallery list and the bytes are authorized by the same rule. Image metadata rides on the Style lookup that is already made (one query per page, not per Style or Store), and nothing about Style Master browsing or image management is widened. A Style without an image keeps the placeholder. Thumbnails use the existing authenticated `StyleThumbnailCell` and image viewer.

## A6 / A7 separation

A6 adds no store-level Report Sold or Request Return, no mutation of any kind, and changes no Dispatch, A3/A4 evidence, A5 review, `ErveDispatchDeliveryLine`, formula, invoice, E-Way Bill or GST behaviour. Existing dispatch-linked Sales Report and Return workflows are untouched; the screen only links to them.

**How A7 (ISS-089, FIFO allocation) can add store / style / size actions** without making a Distributor pick Dispatch IDs: the `/sources` endpoint already exposes exactly the allocation candidates, one row per `(erveDispatchId, saleOrderLineId)` for a Store × Style × Size × purchase mode, with that source's `availableForActualSale` / `availableForNewReturn`, ordered newest first. A7 can add a mutation that takes `(storeKey, styleId, sizeId, mode, quantity)`, locks the candidate positions with the existing `saleOrReturnPositionLockKey` advisory locks, orders them oldest-first, allocates against each source's available quantity and posts ordinary `DistributorSalesReportLine` / `DistributorReturnLine` rows per source. The cell buttons on this screen are the natural entry points. Nothing in A6 writes aggregate quantities.

## Known limitations

- A Store's Style cards are returned together (pagination is per Store). The UI mounts a Store's grids only while it is expanded.
- Historical destinations with no Retail Store link stay as separate groups by design; there is no automatic mapping.
- Style thumbnails follow the shared image policy (see above); a Style with no image shows the placeholder and opens no viewer.
- `awaiting confirmation` includes Dispatches that already have an Admin/legacy ledger but no Distributor receipt; the ledger is shown beside it, not as Distributor verification.

## Verification

- API integration (disposable PostgreSQL): `retail-store-inventory.test.ts` (17 scenarios), `retail-store-inventory.performance.test.ts` (flat query count), `retail-store-inventory-measures.unit.test.ts`.
- Web: `RetailStoreInventory.test.tsx`.
- Browser (`tools/retail-store-inventory/browser.mjs`, guarded to a local `a6_browser_test` database): Distributor, Accountant and Admin at 1440px and 375px, no page overflow, grids scroll internally, drilldown fits, Style thumbnails visible to all three with the placeholder for a Style without an image, the thumbnail opens the image viewer, and a Distributor/anonymous request for a Style outside its records is denied (403/401).
