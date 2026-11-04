import { DescriptionList, Panel } from '@erve/layout';
import type { ErveDispatchView } from '../types.js';
import { DispatchQuantityMatrix } from './DispatchQuantityMatrix.js';

export function DispatchReceiptTab({ dispatch }: { dispatch: ErveDispatchView }) {
  const assumed = dispatch.deliveryConfirmationSource === 'LEGACY_ASSUMED_FULL_RECEIPT';
  const confirmed = dispatch.deliveryConfirmationSource === 'USER_CONFIRMED';
  const received = new Map(
    dispatch.deliveryLines?.map((line) => [line.saleOrderLineId, line.receivedQuantity]),
  );
  // Only persisted evidence is displayed. Missing evidence is not a zero or full receipt.
  const lines = (dispatch.quantityLines ?? [])
    .filter((line) => received.has(line.saleOrderLineId))
    .map((line) => ({ ...line, quantity: received.get(line.saleOrderLineId)! }));
  return (
    <div className="space-y-4">
      <Panel title="Distributor Receipt">
        <p className="text-sm">Separate distributor confirmation is not yet available.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {assumed
            ? 'Assumed full receipt (legacy — not actually confirmed). Recorded quantities are compatibility assumptions, not distributor confirmation.'
            : confirmed
              ? 'Delivery was confirmed through the Admin / Merchandiser fallback. This is recorded delivery evidence, not a separate distributor sign-off.'
              : 'No confirmed receipt evidence is available. Dispatched quantities do not establish quantities received by the distributor.'}
        </p>
        {(confirmed || assumed) && (
          <div className="mt-3">
            <DescriptionList columns={3}>
              <DescriptionList.Item
                label="Evidence Source"
                value={assumed ? 'Legacy assumption' : 'Admin / Merchandiser delivery fallback'}
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
    </div>
  );
}
