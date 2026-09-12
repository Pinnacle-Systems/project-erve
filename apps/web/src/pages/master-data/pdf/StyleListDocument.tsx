import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import { PdfThumbnail } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { StyleListPdfRow, StyleListPdfViewModel } from './buildStyleListViewModel.js';

const columns: PdfTableColumn<StyleListPdfRow>[] = [
  {
    key: 'image',
    header: 'Image',
    width: '9%',
    render: (row) => <PdfThumbnail image={row.image} width={28} height={28} />,
  },
  { key: 'styleNumber', header: 'Style Code', width: '16%', value: (row) => row.styleNumber },
  { key: 'styleName', header: 'Style Name', width: '30%', value: (row) => row.styleName },
  { key: 'season', header: 'Season', width: '20%', value: (row) => row.seasonLabel },
  { key: 'hsn', header: 'HSN', width: '13%', value: (row) => row.hsnCode },
  { key: 'status', header: 'Status', width: '12%', value: (row) => row.status },
];

export interface StyleListDocumentProps {
  viewModel: StyleListPdfViewModel;
}

/** Landscape by design (per the PDF initiative's Style scope), pure render — no HTTP, no business logic. */
export function StyleListDocument({ viewModel }: StyleListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="styles"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
