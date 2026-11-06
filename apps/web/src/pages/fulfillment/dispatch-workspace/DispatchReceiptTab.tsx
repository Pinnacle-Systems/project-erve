import { DescriptionList, Panel } from '@erve/layout';
import type { ErveDispatchView } from '../types.js';
import { DispatchQuantityMatrix } from './DispatchQuantityMatrix.js';
import { DistributorReceiptEvidence } from './DistributorReceiptEvidence.js';
import { DistributorReceiptForm } from './DistributorReceiptForm.js';

export function DispatchReceiptTab({ dispatch }: { dispatch: ErveDispatchView }) {
  const receipt = dispatch.distributorReceipt ?? null;
  const showForm = !receipt && dispatch.canSubmitDistributorReceipt === true;
  // An applied distributor receipt IS the ledger; otherwise the earlier
  // confirmation (if any) is shown separately as the ledger still in use.
  // While the distributor is entering a first receipt and no earlier ledger
  // exists, there is nothing to show beneath the form.
  const showLedger = receipt
    ? receipt.ledgerDisposition !== 'APPLIED'
    : !(showForm && dispatch.deliveryConfirmationSource === null);
  return (
    <div className="space-y-4">
      {receipt && <DistributorReceiptEvidence dispatch={dispatch} receipt={receipt} />}
      {showForm && <DistributorReceiptForm dispatch={dispatch} />}
      {showLedger && <ConfirmedLedgerPanels dispatch={dispatch} hasReceipt={receipt !== null} />}
    </div>
  );
}

function ConfirmedLedgerPanels({
  dispatch,
  hasReceipt,
}: {
  dispatch: ErveDispatchView;
  hasReceipt: boolean;
}) {
  const assumed = dispatch.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT';
  const confirmed = dispatch.deliveryConfirmationSource === 'USER_CONFIRMED';
  const distributorConfirmed = dispatch.deliveryConfirmationSource === 'DISTRIBUTOR_CONFIRMED';
  const received = new Map(
    dispatch.deliveryLines?.map((line) => [line.saleOrderLineId, line.receivedQuantity]),
  );
  // Only persisted evidence is displayed. Missing evidence is not a zero or full receipt.
  const lines = (dispatch.quantityLines ?? [])
    .filter((line) => received.has(line.saleOrderLineId))
    .map((line) => ({ ...line, quantity: received.get(line.saleOrderLineId)! }));
  return (
    <>
      <Panel title={hasReceipt ? 'Delivery Confirmation Ledger (In Use)' : 'Distributor Receipt'}>
        <p className="text-sm text-muted-foreground">
          {assumed
            ? 'Assumed full receipt (legacy — not actually confirmed). Recorded quantities are compatibility assumptions, not distributor confirmation.'
            : confirmed
              ? 'Delivery was confirmed through the Admin / Merchandiser fallback. This is recorded delivery evidence, not a distributor sign-off.'
              : distributorConfirmed
                ? 'Delivery was confirmed by the Distributor.'
                : hasReceipt
                  ? 'No received quantities are recorded for this dispatch.'
                  : 'The Distributor has not yet submitted a final receipt. Dispatched quantities do not establish quantities received by the distributor.'}
        </p>
        {(confirmed || assumed || distributorConfirmed) && (
          <div className="mt-3">
            <DescriptionList columns={3}>
              <DescriptionList.Item
                label="Evidence Source"
                value={
                  assumed
                    ? 'Legacy assumption'
                    : distributorConfirmed
                      ? 'Distributor confirmation'
                      : 'Admin / Merchandiser delivery fallback'
                }
              />
              <DescriptionList.Item
                label="Recorded By"
                value={dispatch.deliveredBy?.name ?? 'Not recorded'}
              />
              <DescriptionList.Item
                label="Recorded At"
                value={
                  dispatch.deliveredAt
                    ? new Date(dispatch.deliveredAt).toLocaleString()
                    : 'Not recorded'
                }
              />
              {dispatch.deliveryRemarks && (
                <DescriptionList.Item
                  label="Delivery Remarks"
                  value={dispatch.deliveryRemarks}
                  span={3}
                />
              )}
            </DescriptionList>
          </div>
        )}
      </Panel>
      <Panel
        title={assumed ? 'Legacy Assumed Quantities' : 'Recorded Received Quantities'}
        padding="sm"
      >
        {lines.length ? (
          <DispatchQuantityMatrix lines={lines} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No size-wise received quantities are available.
          </p>
        )}
      </Panel>
    </>
  );
}
