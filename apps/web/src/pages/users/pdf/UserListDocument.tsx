import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { UserListPdfRow, UserListPdfViewModel } from './buildUserListViewModel.js';

const columns: PdfTableColumn<UserListPdfRow>[] = [
  { key: 'name', header: 'Name', width: '16%', value: (row) => row.name },
  { key: 'email', header: 'Email', width: '22%', value: (row) => row.email },
  { key: 'status', header: 'Status', width: '9%', value: (row) => row.status },
  { key: 'roles', header: 'Roles', width: '17%', value: (row) => row.roles },
  { key: 'distributor', header: 'Distributor', width: '15%', value: (row) => row.distributorName },
  { key: 'factory', header: 'Factory', width: '13%', value: (row) => row.factoryName },
  { key: 'createdAt', header: 'Created', width: '8%', value: (row) => row.createdAt },
];

export interface UserListDocumentProps {
  viewModel: UserListPdfViewModel;
}

/** Landscape — Email/Roles/Distributor/Factory alongside Name/Status/Created would cramp badly in Portrait. */
export function UserListDocument({ viewModel }: UserListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="users"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
