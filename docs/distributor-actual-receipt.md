# Distributor actual receipt (A4 — ISS-079 / ISS-080)

An authenticated `DISTRIBUTOR` user attests, once and finally, the quantities
actually received for one of their own Erve Dispatches. Separate from A3 carton
QR evidence, Transporter LR updates and the Admin/Merchandiser delivery
fallback (`PATCH /erve-dispatches/:id/delivery`). Not derived from QR completion
and not gated on the Dispatch already being `DELIVERED`.

## Evidence vs ledger

`ErveDispatchDistributorReceipt` (+ `…Line`) is immutable evidence (database
trigger blocks UPDATE/DELETE). `ErveDispatchDeliveryLine` remains the received-
quantity ledger that Actual Sales, Returns and Sale-or-Return positions read.
The receipt writes through to the ledger only when nothing earlier exists:

| State when the receipt is submitted | `ledgerDisposition` | Ledger / Dispatch |
|---|---|---|
| `DISPATCHED`, no ledger, total received > 0 | `APPLIED` | Ledger rows written; `DELIVERED`, source `DISTRIBUTOR_CONFIRMED` |
| `DISPATCHED`, no ledger, total received = 0 | `NOT_APPLIED_ZERO` | Untouched; stays `DISPATCHED` |
| Any earlier ledger (Admin/Merchandiser or legacy-assumed) | `EVIDENCE_ONLY_EXISTING` | Untouched (quantities, source, status); discrepancy displayed |

The receipt row snapshots the prior header state and each line's
`previousLedgerQuantity`. There is no financial or stock correction in A4;
reconciling a discrepancy is A5.

## Rules

- One receipt per Dispatch, including all-zero: no incremental receipts,
  overwrite or reopen. After any receipt (even all-zero) the Admin/Merchandiser
  fallback is rejected (409), so a contradictory ledger cannot be created.
- Entry is per Style × Size and must cover every dispatched Style × Size;
  `0 ≤ received ≤ dispatched`; remarks are required for any shortage (including
  all-zero); explicit `acknowledged: true` is required.
- A Style × Size backed by several Sale Order lines needs an explicit
  per-source-line allocation only for a **partial** receipt (allocations must
  total the entered quantity and respect each line's dispatched ceiling). Full
  and zero receipts are allocated automatically. A shortage is never silently
  spread across lines (which may differ in Purchase Mode).
- Dispatched quantities are recomputed from the frozen Packing List carton
  lines; nothing client-supplied is trusted.
- `Idempotency-Key` is required. Idempotency is evaluated before the
  stale-version check, so a retry after an uncertain outcome replays the stored
  result (200) even though the version has since moved. Any other repeat is 409.
- Locking: the same `erve-dispatch-<id>` advisory lock as the fallback, so the
  two authorities serialize. Accepted receipts bump `ErveDispatch.version`.

## API

`POST /erve-dispatches/:id/distributor-receipt` (DISTRIBUTOR only, own
distributor only) — body `SubmitDistributorReceiptRequest` in `@erve/types`.
`GET /erve-dispatches/:id` additionally returns `distributorReceipt` and
`canSubmitDistributorReceipt`; `quantityLines` gain `saleOrderNumber` and
`purchaseMode` so allocations can name their source orders.

## Deferred

Admin reopen/reconciliation of a final receipt or of a discrepancy (A5), and
any A6/A7 inventory behaviour.
