import type { ErveDispatchDistributorReceiptView, ErveDispatchView } from '@erve/types';
import { DescriptionList, Panel } from '@erve/layout';
import { StyleSizeMetricMatrix } from '../../../components/style-size-grid/StyleSizeMetricMatrix.js';
import { groupSourceLinesByStyle } from '../style-size-grouping.js';
import { DispatchQuantityMatrix } from './DispatchQuantityMatrix.js';

const purchaseModeLabel = (mode: string) => (mode === 'SALE_RETURN' ? 'Sale or Return' : 'Outright');

const sourceLabel = (source: ErveDispatchView['deliveryConfirmationSource']) =>
  source === 'LEGACY_ASSUMED_FULL_RECEIPT'
    ? 'the legacy assumed full receipt'
    : source === 'DISTRIBUTOR_CONFIRMED'
      ? 'the Distributor receipt'
      : 'the Admin / Merchandiser delivery confirmation';

/** Read-only, immutable Distributor receipt evidence (A4), including how it relates to the ledger that drives downstream. */
export function DistributorReceiptEvidence({
  dispatch,
  receipt,
}: {
  dispatch: ErveDispatchView;
  receipt: ErveDispatchDistributorReceiptView;
}) {
  const applied = receipt.ledgerDisposition === 'APPLIED';
  // Primary images come from the Dispatch's own quantity lines (the receipt lines carry none).
  const imageByStyle = new Map((dispatch.quantityLines ?? []).map((line) => [line.styleId, line.primaryImage]));
  const detailMatrix = groupSourceLinesByStyle(
    receipt.lines.map((line) => ({ ...line, primaryImage: imageByStyle.get(line.styleId) ?? null })),
  );
  const matrixLines = receipt.lines.map((line) => ({
    saleOrderLineId: line.saleOrderLineId,
    styleId: line.styleId,
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    primaryImage: dispatch.quantityLines?.find((q) => q.saleOrderLineId === line.saleOrderLineId)?.primaryImage ?? null,
    sizeId: line.sizeId,
    sizeCode: line.sizeCode,
    sizeLabel: line.sizeLabel,
    sizeSortOrder: line.sizeSortOrder,
    quantity: line.receivedQuantity,
  }));

  return (
    <div className="space-y-4">
      <Panel title="Distributor Receipt — Final Confirmation">
        <p className="text-sm" role="status">
          {receipt.totalReceivedQuantity === 0
            ? 'The Distributor confirmed that nothing was received.'
            : receipt.totalShortageQuantity > 0
              ? `The Distributor confirmed receiving ${receipt.totalReceivedQuantity.toLocaleString()} of ${receipt.totalDispatchedQuantity.toLocaleString()} dispatched (short ${receipt.totalShortageQuantity.toLocaleString()}).`
              : `The Distributor confirmed receiving the full dispatched quantity (${receipt.totalReceivedQuantity.toLocaleString()}).`}{' '}
          This confirmation is final and cannot be changed.
        </p>
        <div className="mt-3">
          <DescriptionList columns={3}>
            <DescriptionList.Item label="Evidence Source" value="Distributor confirmation" />
            <DescriptionList.Item label="Confirmed By" value={receipt.receivedBy.name} />
            <DescriptionList.Item label="Confirmed At" value={new Date(receipt.receivedAt).toLocaleString()} />
            {receipt.remarks && <DescriptionList.Item label="Receipt Remarks" value={receipt.remarks} span={3} />}
          </DescriptionList>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {applied
            ? 'These quantities are now the received quantities used by Actual Sales, Returns and Sale-or-Return positions.'
            : receipt.ledgerDisposition === 'NOT_APPLIED_ZERO'
              ? 'No received quantity was recorded and the dispatch remains Dispatched, so no stock is available for Actual Sales or Returns from this dispatch. Contact Erve India to resolve.'
              : `An earlier confirmation already existed (${sourceLabel(receipt.prior.deliveryConfirmationSource)}). It was not changed: Actual Sales, Returns and Sale-or-Return positions continue to use ${sourceLabel(receipt.prior.deliveryConfirmationSource)}.`}
        </p>
      </Panel>

      <Panel title="Quantities Confirmed by Distributor" padding="sm">
        <DispatchQuantityMatrix lines={matrixLines} />
      </Panel>

      <Panel title="Receipt Detail" padding="sm">
        <StyleSizeMetricMatrix
          label="Distributor receipt detail"
          columns={detailMatrix.columns}
          rows={detailMatrix.rows}
          metrics={[
            { key: 'dispatched', label: 'Dispatched', value: (line) => line.dispatchedQuantity },
            { key: 'received', label: 'Received', value: (line) => line.receivedQuantity },
            {
              key: 'short',
              label: 'Short',
              value: (line) => line.shortageQuantity,
              tone: (total) => (total > 0 ? 'danger' : undefined),
            },
            // Only while an earlier confirmation, not this receipt, still drives Sales and Returns.
            ...(applied
              ? []
              : [
                  {
                    key: 'ledger',
                    label: 'Ledger in Use',
                    value: (line: ErveDispatchDistributorReceiptView['lines'][number]) => line.currentLedgerQuantity,
                    tone: undefined,
                  },
                ]),
          ]}
          detail={(row) => (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {row.sources.map((line) => {
                const differs = !applied && line.currentLedgerQuantity !== null && line.currentLedgerQuantity !== line.receivedQuantity;
                return (
                  <li key={line.saleOrderLineId} className="break-words">
                    {line.sizeCode} · {line.saleOrderNumber} · {purchaseModeLabel(line.purchaseMode)}: dispatched{' '}
                    {line.dispatchedQuantity}, received {line.receivedQuantity}, short {line.shortageQuantity}
                    {!applied && <>, ledger in use {line.currentLedgerQuantity ?? '—'}</>}
                    {differs && <span className="font-medium text-danger"> (differs from the Distributor receipt)</span>}
                  </li>
                );
              })}
            </ul>
          )}
        />
        {receipt.hasLedgerDiscrepancy && (
          <p className="mt-3 text-sm font-medium text-danger" role="alert">
            The Distributor&rsquo;s confirmation differs from the quantities currently used for Sales and Returns. No
            correction has been made.
          </p>
        )}
      </Panel>
    </div>
  );
}
