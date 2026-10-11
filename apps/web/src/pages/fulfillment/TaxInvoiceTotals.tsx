import { TotalsPanel } from '@erve/app-components';
import { Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import type { TaxInvoiceReviewView } from '@erve/types';
import {
  formatInvoiceMoney,
  formatInvoiceAdjustment,
  invoiceIssuedAmount,
} from './tax-invoice-ui.js';

export function TaxInvoiceTotals({ invoice }: { invoice: TaxInvoiceReviewView }) {
  const issued = invoiceIssuedAmount(invoice);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Panel title="HSN tax summary" padding="none">
        {invoice.hsnSummary ? (
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
              {
                key: 'cgst',
                header: 'CGST',
                align: 'right',
                render: (row) => formatInvoiceMoney(row.cgstAmount),
              },
              {
                key: 'sgst',
                header: 'SGST',
                align: 'right',
                render: (row) => formatInvoiceMoney(row.sgstAmount),
              },
              {
                key: 'igst',
                header: 'IGST',
                align: 'right',
                render: (row) => formatInvoiceMoney(row.igstAmount),
              },
            ]}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Tax summary unavailable until prerequisites are complete.
          </p>
        )}
      </Panel>
      <TotalsPanel
        title={invoice.review.isPreview ? 'Preview totals' : 'Issued totals'}
        items={[
          { label: 'Taxable value', value: formatInvoiceMoney(invoice.subtotal) },
          { label: 'CGST', value: formatInvoiceMoney(invoice.totalCgst) },
          { label: 'SGST', value: formatInvoiceMoney(invoice.totalSgst) },
          { label: 'IGST', value: formatInvoiceMoney(invoice.totalIgst) },
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
