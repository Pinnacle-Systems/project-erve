import { useId, useState } from 'react';
import { DataTable, ErrorState } from '@erve/data-display';
import { Button } from '@erve/primitives';
import { Panel } from '@erve/layout';
import type { TaxInvoiceLineView, TaxInvoiceView } from '@erve/types';
import { TaxInvoiceArchivedImageCell } from './TaxInvoiceArchivedImageCell.js';
import { TaxInvoiceDraftImageCell } from './TaxInvoiceDraftImageCell.js';
import { buildTaxInvoiceLineGroups, type TaxInvoiceLineGroup } from './tax-invoice-line-groups.js';
import { TaxInvoiceLineDisclosure } from './TaxInvoiceLineDisclosure.js';
import { formatInvoiceMoney } from './tax-invoice-ui.js';

export function TaxInvoiceLines({
  invoice,
  canOverride,
  pending,
  onOverride,
}: {
  invoice: TaxInvoiceView;
  canOverride: boolean;
  pending: boolean;
  onOverride: (line: TaxInvoiceLineView) => void;
}) {
  const regionId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  let groups: TaxInvoiceLineGroup[];
  try {
    groups = buildTaxInvoiceLineGroups(invoice);
  } catch {
    return (
      <ErrorState
        title="Invoice line presentation unavailable"
        description="The issued presentation does not match its source lines. Contact support; financial totals remain unchanged."
      />
    );
  }
  const active = groups.find((group) => group.id === selected);
  return (
    <Panel title="Invoice lines · physical quantities are read-only" padding="none">
      <DataTable
        density="compact"
        className="[&_th]:px-2 [&_td]:px-2"
        rowKey="id"
        data={groups}
        columns={[
          {
            key: 'style',
            header: 'Style',
            className: 'whitespace-normal max-w-none',
            render: (group) => {
              const line = group.sourceLines[0]!;
              return (
                <div className="flex items-center gap-2">
                  <div className="shrink-0">
                    {invoice.status === 'DRAFT' ? (
                      <TaxInvoiceDraftImageCell
                        invoiceId={invoice.id}
                        styleId={line.style.id}
                        image={line.style.primaryImage ?? null}
                        styleNumber={group.styleNumber}
                      />
                    ) : (
                      <TaxInvoiceArchivedImageCell
                        invoiceId={invoice.id}
                        image={group.image}
                        styleNumber={group.styleNumber}
                      />
                    )}
                  </div>
                  <div className="min-w-0 break-words">
                    <span className="font-medium">{group.styleNumber}</span>
                    <div className="text-xs text-muted-foreground">{group.styleName}</div>
                    <Button
                      variant="link"
                      className="mt-1 text-xs font-normal"
                      aria-label={`Source lines (${group.sourceLines.length}) for ${group.styleNumber}`}
                      aria-expanded={selected === group.id}
                      aria-controls={regionId}
                      onClick={() => setSelected(selected === group.id ? null : group.id)}
                    >
                      Source lines ({group.sourceLines.length})
                    </Button>
                  </div>
                </div>
              );
            },
          },
          {
            key: 'sizes',
            header: 'Size : Quantity',
            className: 'whitespace-normal max-w-none',
            render: (group) => <span className="block break-words">{group.sizes}</span>,
          },
          {
            key: 'quantity',
            header: 'Total Qty',
            align: 'right',
            render: (group) => group.quantity.toLocaleString('en-IN'),
          },
          {
            key: 'mrp',
            header: (
              <span>
                Frozen MRP /<br />
                pricing
              </span>
            ),
            align: 'right',
            render: (group) => (
              <div>
                {formatInvoiceMoney(group.sourceLines[0]!.styleMrp)}
                <div className="text-xs text-muted-foreground">
                  {group.sourceLines[0]!.distributorPricingPercentage}% of MRP
                </div>
              </div>
            ),
          },
          {
            key: 'rate',
            header: 'Unit rate',
            align: 'right',
            render: (group) => (
              <div>
                {formatInvoiceMoney(group.sourceLines[0]!.finalUnitRate)}
                {group.sourceLines.some((line) => line.overrideUnitRate !== null) && (
                  <div className="text-xs text-muted-foreground">Override · see lines</div>
                )}
              </div>
            ),
          },
          {
            key: 'hsn',
            header: 'HSN / GST',
            render: (group) => (
              <div>
                {group.sourceLines[0]!.hsn?.code ?? 'Unassigned'}
                <div className="text-xs text-muted-foreground">
                  {group.sourceLines[0]!.gstPercent === null
                    ? 'Unavailable'
                    : group.sourceLines[0]!.gstPercent + '%'}
                </div>
              </div>
            ),
          },
          {
            key: 'taxable',
            header: 'Taxable',
            align: 'right',
            render: (group) => formatInvoiceMoney(group.taxableValue),
          },
        ]}
      />
      {active && (
        <div
          id={regionId}
          role="region"
          aria-label={'Source lines for ' + active.styleNumber}
          className="space-y-2 p-3"
        >
          <h3 className="text-sm font-medium">{active.styleNumber} · individual source lines</h3>
          <TaxInvoiceLineDisclosure
            invoice={invoice}
            group={active}
            canOverride={canOverride && invoice.status === 'DRAFT'}
            pending={pending}
            onOverride={onOverride}
          />
        </div>
      )}
    </Panel>
  );
}
