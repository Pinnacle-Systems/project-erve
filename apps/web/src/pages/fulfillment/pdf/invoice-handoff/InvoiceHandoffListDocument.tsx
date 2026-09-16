import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { InvoiceHandoffListPdfRow, InvoiceHandoffListPdfViewModel } from './buildInvoiceHandoffListViewModel.js';

const columns: PdfTableColumn<InvoiceHandoffListPdfRow>[] = [
  { key: 'modeLabel', header: 'Mode', width: '10%', value: (row) => row.modeLabel },
  { key: 'erveDispatchNumber', header: 'Dispatch #', width: '14%', value: (row) => row.erveDispatchNumber },
  { key: 'distributorName', header: 'Distributor', width: '18%', value: (row) => row.distributorName },
  { key: 'styleDisplay', header: 'Style / Size', width: '18%', value: (row) => row.styleDisplay },
  { key: 'quantity', header: 'Qty', width: '8%', align: 'right', value: (row) => row.quantity },
  { key: 'statusLabel', header: 'Status', width: '12%', value: (row) => row.statusLabel },
  { key: 'tallyInvoiceNumber', header: 'Tally Invoice #', width: '12%', value: (row) => row.tallyInvoiceNumber },
  { key: 'tallyInvoiceDate', header: 'Tally Date', width: '8%', value: (row) => row.tallyInvoiceDate },
];

export interface InvoiceHandoffListDocumentProps {
  viewModel: InvoiceHandoffListPdfViewModel;
}

/** Landscape — 8 columns (Mode, Dispatch #, Distributor, Style/Size, Qty, Status, Tally reference/date) would cramp in Portrait. */
export function InvoiceHandoffListDocument({ viewModel }: InvoiceHandoffListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Invoice Handoffs"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
