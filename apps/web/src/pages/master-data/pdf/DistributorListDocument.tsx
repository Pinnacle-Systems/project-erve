import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type {
  DistributorListPdfRow,
  DistributorListPdfViewModel,
} from './buildDistributorListViewModel.js';

const columns: PdfTableColumn<DistributorListPdfRow>[] = [
  { key: 'code', header: 'Code', width: '18%', value: (row) => row.code },
  { key: 'name', header: 'Name', width: '32%', value: (row) => row.name },
  { key: 'contactName', header: 'Contact', width: '25%', value: (row) => row.contactName },
  { key: 'city', header: 'City', width: '15%', value: (row) => row.city },
  { key: 'status', header: 'Status', width: '10%', value: (row) => row.status },
];

export interface DistributorListDocumentProps {
  viewModel: DistributorListPdfViewModel;
}

/** Portrait — this 5-column set (the list endpoint's current field set) reads comfortably without cramping. */
export function DistributorListDocument({ viewModel }: DistributorListDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="distributors"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
