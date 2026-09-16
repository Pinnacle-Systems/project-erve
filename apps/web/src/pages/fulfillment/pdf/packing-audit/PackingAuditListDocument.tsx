import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { PackingAuditListPdfRow, PackingAuditListPdfViewModel } from './buildPackingAuditListViewModel.js';

const columns: PdfTableColumn<PackingAuditListPdfRow>[] = [
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '28%', value: (row) => row.saleOrderNumber },
  { key: 'factoryName', header: 'Factory', width: '22%', value: (row) => row.factoryName },
  { key: 'cartonNumber', header: 'Carton #', width: '18%', value: (row) => row.cartonNumber },
  { key: 'totalQuantity', header: 'Total Qty', width: '14%', align: 'right', value: (row) => row.totalQuantity },
  { key: 'auditStateLabel', header: 'Audit State', width: '18%', value: (row) => row.auditStateLabel },
];

export interface PackingAuditListDocumentProps {
  viewModel: PackingAuditListPdfViewModel;
}

/** Portrait — only 5 narrow columns, no address/description field wide enough to need Landscape. */
export function PackingAuditListDocument({ viewModel }: PackingAuditListDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
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
