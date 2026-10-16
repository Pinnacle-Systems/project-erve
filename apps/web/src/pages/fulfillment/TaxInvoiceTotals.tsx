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
  const isIntra = invoice.gstTreatment === 'INTRA';
  const isInter = invoice.gstTreatment === 'INTER';
  const taxTotals = isIntra
    ? [
        { label: 'CGST', value: formatInvoiceMoney(invoice.totalCgst) },
        { label: 'SGST', value: formatInvoiceMoney(invoice.totalSgst) },
      ]
    : isInter
      ? [{ label: 'IGST', value: formatInvoiceMoney(invoice.totalIgst) }]
      : [{ label: 'Tax components', value: 'Unavailable until GST treatment is resolved' }];
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <Panel title="HSN tax summary" padding="none" className="min-w-0">
        {invoice.hsnSummary && (isIntra || isInter) ? (
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
              ...(isIntra
                ? [
                    {
                      key: 'cgst',
                      header: 'CGST',
                      align: 'right' as const,
                      render: (row: TaxInvoiceHsnSummary) => formatInvoiceMoney(row.cgstAmount),
                    },
                    {
                      key: 'sgst',
                      header: 'SGST',
                      align: 'right' as const,
                      render: (row: TaxInvoiceHsnSummary) => formatInvoiceMoney(row.sgstAmount),
                    },
                  ]
                : []),
              ...(isInter
                ? [
                    {
                      key: 'igst',
                      header: 'IGST',
                      align: 'right' as const,
                      render: (row: TaxInvoiceHsnSummary) => formatInvoiceMoney(row.igstAmount),
                    },
                  ]
                : []),
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
