# Correction 8 — multi-distributor Dispatch Orders

This supersedes the single-Distributor Dispatch Order assumption in the
decision-aligned BRD (`ERVE_India_BRD_Decision_Aligned_v2.1.pdf`) and the
pre-Correction-8 User Manual on this specific point; the BRD PDF itself was
not edited (only its published source would be, and only a PDF exists), so
this file is the authoritative record going forward. Confirmed decision: one
Dispatch Order belongs to one Factory but may contain multiple Distributors.
Each Distributor may contain multiple destination/store snapshots, each with
its own Style/Size/Quantity allocation. The prior practice of emailing each
Distributor's paperwork separately is a communication habit only and was
never a constraint the in-system Dispatch Order needed to inherit.

Distributor → destination snapshot lineage is retained end to end — Dispatch
Order → Distributor group → destination → line → carton → Erve Consolidated
Packing List (EIPL) → Erve Dispatch → delivery/Actual Sales/Returns — because
it is required for future distributor reporting, store/destination
reporting, Actual Sales, SALE_RETURN exposure, returns and resales,
distributor/store profitability, pricing and financial calculations,
GST/tax processing, and COGS and management reporting. Distributor/Store
data is a lineage-bearing commercial fact, not a shipping label.

`SaleOrderDistributor` (schema.prisma) is the new grouping entity between
`SaleOrder` and `SaleOrderDestination` — one row per (Dispatch Order,
Distributor), unique on that pair, so a Distributor may appear at most once
per Dispatch Order; its stores are represented by multiple destinations
under that one group, not multiple groups. It snapshots `purchaseMode`
(copied from `Distributor.purchaseMode` the moment that Distributor is
attached) because `Distributor.purchaseMode` is required at creation and
immutable thereafter (`master-data.validation.ts`'s `updateDistributorSchema`
structurally excludes it), so the snapshot can never diverge from the
master — this mirrors the pre-existing snapshot precedent on
`DistributorPurchaseOrder.purchaseMode`. Distributor name/code/GSTIN are
deliberately NOT snapshotted — every other reference to a Distributor's
descriptive identity in this codebase is a live join, and extending the
snapshot convention to cover them would be exactly the "complete accounting
snapshot model" the correction brief warned against inventing. A historical
Dispatch Order's displayed Distributor name/code/GSTIN therefore always
reflects the current master, while its Purchase Mode reflects what it was
at the time that Distributor was attached.

`SaleOrder.distributorId` (the old single-Distributor root scalar) was
removed outright in the same migration
(`20260911122915_multi_distributor_dispatch_orders`) rather than deprecated
in place, so there is exactly one writable Distributor source of truth going
forward. `SaleOrderDestination` gained `saleOrderDistributorId`, DB-enforced
via a composite foreign key `(saleOrderDistributorId, saleOrderId) ->
sale_order_distributors(id, saleOrderId)` so Postgres itself rejects a
destination pointing at a group belonging to a different order — not left to
service-layer discipline alone. `SaleOrderDestination` kept its existing
`saleOrderId` scalar too (denormalized, additive) so every pre-existing
`saleOrderId`-keyed query continues to work unchanged. No schema change was
needed on `SaleOrderLine` or any downstream fulfillment model
(`FactoryPackingCarton`, `StockAllocation`, `InvoiceHandoff`,
`DistributorSalesReportLine`, `ErveDispatchDeliveryLine`,
`DistributorReturnLine`, `FactoryInvoiceLine`) — a line's Distributor lineage
is transitive through its already-existing `destinationId`, so every
downstream identity, including `(erveDispatchId, saleOrderLineId)`, is
preserved unchanged.

Pooled Factory+Style+Size inventory reservation (`sale-orders.service.ts`)
was already distributor-agnostic before this correction and required no
change — availability is checked in aggregate across every Distributor and
destination on one Dispatch Order, so two Distributors on the same order
each requesting stock within the pool's total can still, combined, exceed
what is available, and that combined request is rejected.

A destination may be moved to a different Distributor group already on the
same Dispatch Order, in the same edit request, preserving the destination's
own row identity and every line beneath it — gated strictly on that
destination having zero packed cartons (the same predicate the read
projection's `canMoveDistributor` field uses, so client and server can never
disagree about eligibility). This is the correction's one genuinely new edit
capability beyond ordinary add/remove; it exists because no Distributor-
sensitive downstream record (Factory Invoice line, EIPL, Erve Dispatch,
InvoiceHandoff, delivery/Actual-Sales/Returns line) can exist for a
destination before its first carton does, so "zero cartons" is the exact,
earliest safe boundary — verified by reading the fulfillment chain, not
assumed.

Downstream invariants preserved unchanged: one Factory Packing List per
Dispatch Order regardless of how many Distributors it covers; one carton
belongs to exactly one destination and therefore exactly one Distributor,
never mixed; one Factory Invoice per finalized Factory Packing List, still
Factory-to-Erve only, unaffected by Distributor count; Erve Consolidated
Packing List (EIPL) consolidation still requires the same Distributor and a
matching normalized destination address, so a multi-Distributor Dispatch
Order's cartons now typically split across several EIPLs rather than
consolidating into one; Erve Dispatch remains one Distributor plus one
destination, unchanged. GSTIN was added as an optional, format-validated-
only destination field (no Bill-To/Ship-To tax-treatment logic attached),
confirmed necessary by inspecting a real operational Dispatch Order
distributor-store email, not merely assumed from the brief's field list.

Out of scope for this correction, unchanged: Store master, Distributor-
facing Dispatch Order screens, assortment logic, a Draft/Release/Approval
workflow, partial-fulfilment lifecycle, direct factory-to-store dispatch,
new tax calculation rules, management P&L/COGS implementation, customer
email automation, and PDF generation/printing (the existing backlog item for
professional client-side PDF generation across all forms remains a separate,
untouched implementation item).
