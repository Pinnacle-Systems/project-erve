import { DataTable } from '@erve/data-display';
import { Button } from '@erve/primitives';
import type { TaxInvoiceLineView, TaxInvoiceView } from '@erve/types';
import type { TaxInvoiceLineGroup } from './tax-invoice-line-groups.js';
import { formatInvoiceMoney, formatInvoiceTimestamp } from './tax-invoice-ui.js';

export function TaxInvoiceLineDisclosure({
  invoice,
  group,
  canOverride,
  pending,
  onOverride,
}: {
  invoice: TaxInvoiceView;
  group: TaxInvoiceLineGroup;
  canOverride: boolean;
  pending: boolean;
  onOverride: (line: TaxInvoiceLineView) => void;
}) {
  return (
    <DataTable
      density="compact"
      rowKey="id"
      data={group.sourceLines}
      columns={[
        {
          key: 'source',
          header: 'Source / Size',
          className: 'whitespace-normal max-w-none',
          render: (line) => (
            <div>
              {invoice.status === 'DRAFT'
                ? line.size.label
                : (invoice.documentSnapshot?.lines.find((item) => item.lineId === line.id)?.size
                    .label ?? 'Not recorded')}
              <div className="break-all text-xs text-muted-foreground">{line.id}</div>
            </div>
          ),
        },
        {
          key: 'quantity',
          header: 'Qty',
          align: 'right',
          render: (line) => line.quantity.toLocaleString('en-IN'),
        },
        {
          key: 'calculated',
          header: 'Calculated rate',
          align: 'right',
          render: (line) => formatInvoiceMoney(line.calculatedUnitRate),
        },
        {
          key: 'final',
          header: 'Final rate',
          align: 'right',
          render: (line) => formatInvoiceMoney(line.finalUnitRate),
        },
        {
          key: 'override',
          header: 'Override / reason',
          className: 'whitespace-normal max-w-none',
          render: (line) =>
            line.overrideUnitRate === null ? (
              'No override'
            ) : (
              <div>
                {formatInvoiceMoney(line.overrideUnitRate)}
                <div className="break-words text-xs">{line.overrideReason}</div>
                <div className="text-xs text-muted-foreground">
                  {line.overriddenBy?.name}
                  {line.overriddenAt ? ' · ' + formatInvoiceTimestamp(line.overriddenAt) : ''}
                </div>
              </div>
            ),
        },
        ...(canOverride
          ? [
              {
                key: 'action',
                header: 'Review',
                render: (line: TaxInvoiceLineView) => (
                  <Button
                    variant="secondary"
                    density="compact"
                    disabled={pending}
                    onClick={() => onOverride(line)}
                  >
                    Override
                  </Button>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}
