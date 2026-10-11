import { DataTable } from '@erve/data-display';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import type { TaxInvoiceLineView, TaxInvoiceDocumentSnapshot } from '@erve/types';
import { TaxInvoiceArchivedImageCell } from './TaxInvoiceArchivedImageCell.js';
import { formatInvoiceMoney } from './tax-invoice-ui.js';

export function TaxInvoiceLines({
  lines,
  canOverride,
  pending,
  onOverride,
  invoiceId,
  documentSnapshot,
}: {
  lines: TaxInvoiceLineView[];
  canOverride: boolean;
  pending: boolean;
  onOverride: (line: TaxInvoiceLineView) => void;
  invoiceId: string;
  documentSnapshot: TaxInvoiceDocumentSnapshot | null;
}) {
  return (
    <Panel title="Invoice lines · physical quantities are read-only" padding="none">
      <DataTable
        rowKey="id"
        data={lines}
        columns={[
          {
            key: 'image',
            header: 'Image',
            render: (row) => (
              <TaxInvoiceArchivedImageCell
                invoiceId={invoiceId}
                image={
                  documentSnapshot?.lines.find((item) => item.lineId === row.id)?.image ?? null
                }
                styleNumber={row.style.styleNumber}
              />
            ),
          },
          {
            key: 'style',
            header: 'Style',
            render: (row) => (
              <div>
                <span className="font-medium">{row.style.styleNumber}</span>
                <div className="text-xs text-muted-foreground">{row.style.styleName}</div>
              </div>
            ),
          },
          { key: 'size', header: 'Size', render: (row) => row.size.label },
          {
            key: 'quantity',
            header: 'Qty',
            align: 'right',
            render: (row) => row.quantity.toLocaleString('en-IN'),
          },
          {
            key: 'mrp',
            header: 'Frozen MRP / pricing',
            align: 'right',
            render: (row) => (
              <div>
                {formatInvoiceMoney(row.styleMrp)}
                <div className="text-xs text-muted-foreground">
                  {row.distributorPricingPercentage}% of MRP
                </div>
              </div>
            ),
          },
          {
            key: 'rate',
            header: 'Unit rate',
            align: 'right',
            render: (row) => (
              <div>
                {formatInvoiceMoney(row.finalUnitRate)}
                {row.overrideUnitRate !== null && (
                  <div
                    className="text-xs text-muted-foreground"
                    title={row.overrideReason ?? undefined}
                  >
                    Override · original {formatInvoiceMoney(row.calculatedUnitRate)}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'hsn',
            header: 'HSN / GST',
            render: (row) => (
              <div>
                {row.hsn?.code ?? 'Unassigned'}
                <div className="text-xs text-muted-foreground">
                  {row.gstPercent === null ? 'Unavailable' : `${row.gstPercent}%`}
                </div>
              </div>
            ),
          },
          {
            key: 'taxable',
            header: 'Taxable amount',
            align: 'right',
            render: (row) => formatInvoiceMoney(row.taxableValue),
          },
          ...(canOverride
            ? [
                {
                  key: 'action',
                  header: 'Review',
                  render: (row: TaxInvoiceLineView) => (
                    <Button
                      variant="secondary"
                      density="compact"
                      disabled={pending}
                      onClick={() => onOverride(row)}
                    >
                      Override
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
    </Panel>
  );
}
