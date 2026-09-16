import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { FactoryInvoiceListPdfRow, FactoryInvoiceListPdfViewModel } from './buildFactoryInvoiceListViewModel.js';

const columns: PdfTableColumn<FactoryInvoiceListPdfRow>[] = [
  { key: 'factoryName', header: 'Factory', width: '16%', value: (row) => row.factoryName },
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '14%', value: (row) => row.saleOrderNumber },
  { key: 'factoryDispatchNumber', header: 'Factory Dispatch #', width: '14%', value: (row) => row.factoryDispatchNumber },
  { key: 'lineCount', header: 'Lines', width: '8%', align: 'right', value: (row) => row.lineCount },
  { key: 'subtotal', header: 'Subtotal', width: '13%', align: 'right', value: (row) => row.subtotal },
  { key: 'gstAmount', header: 'GST', width: '12%', align: 'right', value: (row) => row.gstAmount },
  { key: 'total', header: 'Total', width: '13%', align: 'right', value: (row) => row.total },
  { key: 'statusLabel', header: 'Status', width: '10%', value: (row) => row.statusLabel },
];

export interface FactoryInvoiceListDocumentProps {
  viewModel: FactoryInvoiceListPdfViewModel;
}

/** Landscape — Factory/Dispatch Order text plus four right-aligned financial columns would cramp badly in Portrait. */
export function FactoryInvoiceListDocument({ viewModel }: FactoryInvoiceListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Factory Invoices"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
