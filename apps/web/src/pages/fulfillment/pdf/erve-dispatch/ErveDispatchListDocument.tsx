import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { ErveDispatchListPdfRow, ErveDispatchListPdfViewModel } from './buildErveDispatchListViewModel.js';

const columns: PdfTableColumn<ErveDispatchListPdfRow>[] = [
  { key: 'erveDispatchNumber', header: 'Dispatch #', width: '12%', value: (row) => row.erveDispatchNumber },
  { key: 'ervePackingListNumber', header: 'EIPL Number', width: '12%', value: (row) => row.ervePackingListNumber },
  { key: 'distributorName', header: 'Distributor', width: '15%', value: (row) => row.distributorName },
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '12%', value: (row) => row.saleOrderNumber },
  { key: 'dispatchDate', header: 'Dispatch Date', width: '10%', value: (row) => row.dispatchDate },
  { key: 'statusLabel', header: 'Status', width: '8%', value: (row) => row.statusLabel },
  { key: 'deliveredAt', header: 'Delivered', width: '10%', value: (row) => row.deliveredAt },
  { key: 'transporter', header: 'Transporter', width: '11%', value: (row) => row.transporter },
  { key: 'lrNumber', header: 'LR Number', width: '10%', value: (row) => row.lrNumber },
];

export interface ErveDispatchListDocumentProps {
  viewModel: ErveDispatchListPdfViewModel;
}

/** Landscape — 9 columns (Dispatch #, EIPL Number, Distributor, Dispatch Order, dates, status, transport) would cramp in Portrait. */
export function ErveDispatchListDocument({ viewModel }: ErveDispatchListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Erve Dispatches"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
