import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { PackingAuditListPdfRow, PackingAuditListPdfViewModel } from './buildPackingAuditListViewModel.js';

const columns: PdfTableColumn<PackingAuditListPdfRow>[] = [
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '18%', value: (row) => row.saleOrderNumber },
  { key: 'factoryName', header: 'Factory', width: '13%', value: (row) => row.factoryName },
  { key: 'distributorName', header: 'Distributor', width: '16%', value: (row) => row.distributorName },
  { key: 'destinationLabel', header: 'Destination', width: '24%', value: (row) => row.destinationLabel },
  { key: 'cartonNumber', header: 'Carton #', width: '9%', value: (row) => row.cartonNumber },
  { key: 'totalQuantity', header: 'Total Qty', width: '8%', align: 'right', value: (row) => row.totalQuantity },
  { key: 'auditStateLabel', header: 'Audit State', width: '12%', value: (row) => row.auditStateLabel },
];

export interface PackingAuditListDocumentProps {
  viewModel: PackingAuditListPdfViewModel;
}

/** Landscape provides room for all seven columns and long outlet names on multi-page queues. */
export function PackingAuditListDocument({ viewModel }: PackingAuditListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Cartons"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
