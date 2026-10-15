# Tax Invoice draft Bill-To recovery

An ACCOUNTANT can repair an existing unissued DRAFT after its associated Distributor master is corrected. Reopening the draft checks the Bill-To source independently of GST calculation. Select **Review Bill-To changes**, compare saved/current values, enter a mandatory reason, and apply the correction.

The action refreshes only Bill-To name, GSTIN, contact and address fields. It preserves the Tax Invoice ID, source references, commercial quantities/prices, overrides, seller, Ship-To, replacement provenance and existing audit history. It does not allocate an invoice number. Preview recalculates through the existing current HSN/GST rule path; issuance readiness remains a separate guard.

The source is the Distributor identified by the invoice's distributorId, not the Ship-To destination. State must resolve through the existing name/alias resolver and match the proposed GSTIN prefix. Invalid proposed data remains blocked.

The comparison carries the invoice revision, Distributor timestamp and proposed-value fingerprint. Confirmation stabilizes the Distributor row, serializes against invoice lifecycle actions, and writes snapshot/revision/audit atomically. A request key plus request fingerprint in that audit row makes exact retries safe and rejects conflicting key reuse. A refresh committed between finalization preparation and financial commit causes issuance to abort before number allocation; the user must review and retry.

FINALIZED and CANCELLED invoices cannot be refreshed. Statutory cancellation, GST arithmetic and historical snapshots are unchanged. No schema migration is required.

## Acceptance

Use isolated data: create a draft while its Bill-To State is missing; observe BILL_TO_STATE_UNRESOLVED; correct the same Distributor through the normal master API; reopen the same invoice; compare/apply with a reason; verify persisted State, valid GST preview, unchanged commercial facts, no sequence change and one appended recovery audit. Also verify role denial, State/GSTIN mismatch, stale master/revision, concurrent requests, audit failure rollback and refresh between media upload and issuance commit.

Native invoice CI is enabled for feature/tax-invoice-bill-to-recovery and verifies this journey at 1440, 1280 and 1024 desktop widths. The recovered issued PDF is checked for corrected Bill-To details alongside existing immutable-document PDF regressions.

## Issue boundary

ISS-028 is implemented by this controlled snapshot repair. ISS-027 is addressed for stale Bill-To identity/contact/address recovery on an unissued draft; general discard, arbitrary draft rebuilding, seller-snapshot repair and other validation causes are not implemented. Other failures still require their own supported master/configuration correction or a separately approved recovery scope.

Production deployment, production records and invoice-numbering cutover are excluded. Merge does not authorize deployment or customer UAT closure.
