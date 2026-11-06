import { Fragment } from 'react';
import type { ErveDispatchDistributorReceiptView, ErveDispatchView } from '@erve/types';
import { DescriptionList, Panel } from '@erve/layout';
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
  const rows = new Map<string, ErveDispatchDistributorReceiptView['lines']>();
  for (const line of receipt.lines) {
    const key = `${line.styleId}::${line.sizeId}`;
    rows.set(key, [...(rows.get(key) ?? []), line]);
  }
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
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-xs sm:text-sm" aria-label="Distributor receipt detail">
            <thead>
              <tr className="border-b border-[var(--erp-border)] text-left text-xs text-muted-foreground">
                <th className="px-1 py-1 sm:px-2">Style / Size</th>
                <th className="w-14 px-1 py-1 text-right sm:w-24 sm:px-2"><span className="sm:hidden">Disp.</span><span className="hidden sm:inline">Dispatched</span></th>
                <th className="w-14 px-1 py-1 text-right sm:w-24 sm:px-2"><span className="sm:hidden">Recd.</span><span className="hidden sm:inline">Received</span></th>
                <th className="w-12 px-1 py-1 text-right sm:w-20 sm:px-2">Short</th>
                {!applied && <th className="w-14 px-1 py-1 text-right sm:w-28 sm:px-2">Ledger<span className="hidden sm:inline"> in Use</span></th>}
              </tr>
            </thead>
            <tbody>
              {[...rows.entries()].map(([key, lines]) => {
                const dispatched = lines.reduce((sum, l) => sum + l.dispatchedQuantity, 0);
                const got = lines.reduce((sum, l) => sum + l.receivedQuantity, 0);
                const ledger = lines.every((l) => l.currentLedgerQuantity !== null)
                  ? lines.reduce((sum, l) => sum + (l.currentLedgerQuantity ?? 0), 0)
                  : null;
                const differs = !applied && ledger !== null && ledger !== got;
                const first = lines[0]!;
                return (
                  <Fragment key={key}>
                    <tr className="border-b border-[var(--erp-border)]">
                      <td className="break-all px-1 py-1 sm:px-2">{first.styleNumber} / {first.sizeLabel}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dispatched}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{got}</td>
                      <td className={`px-2 py-1 text-right tabular-nums ${dispatched > got ? 'font-medium text-danger' : ''}`}>{dispatched - got}</td>
                      {!applied && (
                        <td className={`px-2 py-1 text-right tabular-nums ${differs ? 'font-medium text-danger' : ''}`}>
                          {ledger === null ? '—' : ledger}
                          {differs && <span className="sr-only"> (differs from the Distributor receipt)</span>}
                        </td>
                      )}
                    </tr>
                    {lines.length > 1 &&
                      lines.map((line) => (
                        <tr key={line.saleOrderLineId} className="text-xs text-muted-foreground">
                          <td className="break-words px-1 py-0.5 pl-3 sm:px-2 sm:pl-6">{line.saleOrderNumber} · {purchaseModeLabel(line.purchaseMode)}</td>
                          <td className="px-2 py-0.5 text-right tabular-nums">{line.dispatchedQuantity}</td>
                          <td className="px-2 py-0.5 text-right tabular-nums">{line.receivedQuantity}</td>
                          <td className="px-2 py-0.5 text-right tabular-nums">{line.shortageQuantity}</td>
                          {!applied && <td className="px-2 py-0.5 text-right tabular-nums">{line.currentLedgerQuantity ?? '—'}</td>}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
