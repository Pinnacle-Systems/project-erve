import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { SizeListPdfRow, SizeListPdfViewModel } from './buildSizeListViewModel.js';

const columns: PdfTableColumn<SizeListPdfRow>[] = [
  { key: 'code', header: 'Code', width: '22%', value: (row) => row.code },
  { key: 'label', header: 'Label', width: '28%', value: (row) => row.label },
  { key: 'sizeType', header: 'Type', width: '20%', value: (row) => row.sizeType },
  { key: 'sortOrder', header: 'Sort', width: '15%', align: 'right', value: (row) => row.sortOrder },
  { key: 'status', header: 'Status', width: '15%', value: (row) => row.status },
];

export interface SizeListDocumentProps {
  viewModel: SizeListPdfViewModel;
}

/** Portrait — a narrow 5-column set reads comfortably without cramping or shrinking the font. */
export function SizeListDocument({ viewModel }: SizeListDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="sizes"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
