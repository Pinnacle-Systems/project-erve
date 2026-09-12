import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { FactoryListPdfRow, FactoryListPdfViewModel } from './buildFactoryListViewModel.js';

const columns: PdfTableColumn<FactoryListPdfRow>[] = [
  { key: 'code', header: 'Code', width: '13%', value: (row) => row.code },
  { key: 'name', header: 'Name', width: '22%', value: (row) => row.name },
  { key: 'contactName', header: 'Contact', width: '20%', value: (row) => row.contactName },
  { key: 'contactEmail', header: 'Email', width: '25%', value: (row) => row.contactEmail },
  { key: 'contactPhone', header: 'Phone', width: '13%', value: (row) => row.contactPhone },
  { key: 'status', header: 'Status', width: '7%', value: (row) => row.status },
];

export interface FactoryListDocumentProps {
  viewModel: FactoryListPdfViewModel;
}

/** Landscape — Contact Email/Name/Phone alongside Code/Name/Status would cramp or wrap badly in Portrait. */
export function FactoryListDocument({ viewModel }: FactoryListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="factories"
      />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
