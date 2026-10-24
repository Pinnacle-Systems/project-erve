import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { SeasonListPdfRow, SeasonListPdfViewModel } from './buildSeasonListViewModel.js';

const columns: PdfTableColumn<SeasonListPdfRow>[] = [
  { key: 'code', header: 'Code', width: '20%', value: (row) => row.code },
  { key: 'name', header: 'Season Name', width: '45%', value: (row) => row.name },
  { key: 'status', header: 'Status', width: '35%', value: (row) => row.status },
];

export interface SeasonListDocumentProps {
  viewModel: SeasonListPdfViewModel;
}

/** Portrait — a narrow 3-column set reads comfortably without cramping or shrinking the font. */
export function SeasonListDocument({ viewModel }: SeasonListDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="seasons"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
