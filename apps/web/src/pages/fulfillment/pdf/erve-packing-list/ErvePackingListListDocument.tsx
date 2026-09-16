import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { ErvePackingListListPdfRow, ErvePackingListListPdfViewModel } from './buildErvePackingListListViewModel.js';

const columns: PdfTableColumn<ErvePackingListListPdfRow>[] = [
  { key: 'ervePackingListNumber', header: 'EIPL Number', width: '12%', value: (row) => row.ervePackingListNumber },
  { key: 'distributorName', header: 'Distributor', width: '16%', value: (row) => row.distributorName },
  { key: 'destinationDisplay', header: 'Destination', width: '16%', value: (row) => row.destinationDisplay },
  { key: 'cartonCount', header: 'Cartons', width: '8%', align: 'right', value: (row) => row.cartonCount },
  { key: 'totalQuantity', header: 'Total Pieces', width: '10%', align: 'right', value: (row) => row.totalQuantity },
  { key: 'sourceFactoryCount', header: 'Factories', width: '8%', align: 'right', value: (row) => row.sourceFactoryCount },
  { key: 'sourceDispatchOrderCount', header: 'Dispatch Orders', width: '10%', align: 'right', value: (row) => row.sourceDispatchOrderCount },
  { key: 'statusLabel', header: 'Status', width: '9%', value: (row) => row.statusLabel },
  { key: 'createdAt', header: 'Created', width: '11%', value: (row) => row.createdAt },
];

export interface ErvePackingListListDocumentProps {
  viewModel: ErvePackingListListPdfViewModel;
}

/** Landscape — Distributor/Destination text plus Factory/Dispatch Order consolidation counts would cramp badly in Portrait. */
export function ErvePackingListListDocument({ viewModel }: ErvePackingListListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Erve Packing Lists"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
