import { taxInvoiceGstComponents } from './tax-invoice-gst-presentation.js';
import { TotalsPanel } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import type { TaxInvoiceHsnSummary, TaxInvoiceReviewView } from '@erve/types';
import {
  formatInvoiceMoney,
  formatInvoiceAdjustment,
  invoiceIssuedAmount,
} from './tax-invoice-ui.js';

export function TaxInvoiceTotals({ invoice }: { invoice: TaxInvoiceReviewView }) {
  const issued = invoiceIssuedAmount(invoice);
  const components = taxInvoiceGstComponents(invoice.gstTreatment);
  const taxTotals = components.length
    ? components.map((component) => ({
        label: component.label,
        value: formatInvoiceMoney(invoice[component.totalField]),
      }))
    : [{ label: 'Tax components', value: 'Unavailable until GST treatment is resolved' }];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Panel title="HSN tax summary" padding="none" className="min-w-0">
        {invoice.hsnSummary && components.length > 0 ? (
          <DataTable
            rowKey={(row) => `${row.hsnCode}-${row.gstPercent}`}
            data={invoice.hsnSummary}
            columns={[
              { key: 'hsn', header: 'HSN', accessor: 'hsnCode' },
              { key: 'gst', header: 'GST', align: 'right', render: (row) => `${row.gstPercent}%` },
              {
                key: 'taxable',
                header: 'Taxable value',
                align: 'right',
                render: (row) => formatInvoiceMoney(row.taxableValue),
              },
              ...components.map((component) => ({
                key: component.key,
                header: component.label,
                align: 'right' as const,
                render: (row: TaxInvoiceHsnSummary) => formatInvoiceMoney(row[component.hsnField]),
              })),
            ]}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {invoice.gstTreatment
              ? 'Tax summary unavailable until prerequisites are complete.'
              : 'Tax summary unavailable until GST treatment is resolved.'}
          </p>
        )}
      </Panel>
      <TotalsPanel
        title={invoice.review.isPreview ? 'Preview totals' : 'Issued totals'}
        items={[
          { label: 'Taxable value', value: formatInvoiceMoney(invoice.subtotal) },
          ...taxTotals,
          {
            label: 'Grand total (before round-off)',
            value: formatInvoiceMoney(invoice.grandTotal),
          },
          {
            label: 'Round-off adjustment',
            value: formatInvoiceAdjustment(invoice.roundOffAdjustment),
          },
          {
            label: invoice.status === 'DRAFT' ? 'Preview payable' : issued.label,
            value: formatInvoiceMoney(
              invoice.status === 'DRAFT' ? invoice.payableTotal : issued.amount,
            ),
            emphasis: 'strong',
          },
        ]}
      />
    </div>
  );
}
