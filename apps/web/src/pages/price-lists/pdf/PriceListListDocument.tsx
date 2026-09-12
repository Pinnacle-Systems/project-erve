import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { PriceListListPdfRow, PriceListListPdfViewModel } from './buildPriceListListViewModel.js';

const columns: PdfTableColumn<PriceListListPdfRow>[] = [
  { key: 'code', header: 'Code', width: '14%', value: (row) => row.code },
  { key: 'name', header: 'Name', width: '24%', value: (row) => row.name },
  { key: 'distributor', header: 'Distributor', width: '20%', value: (row) => row.distributorName },
  { key: 'effectiveFrom', header: 'Effective From', width: '11%', value: (row) => row.effectiveFrom },
  { key: 'effectiveTo', header: 'Effective To', width: '11%', value: (row) => row.effectiveTo },
  { key: 'lineCount', header: 'Lines', width: '8%', align: 'right', value: (row) => row.lineCount },
  { key: 'status', header: 'Status', width: '12%', value: (row) => row.status },
];

export interface PriceListListDocumentProps {
  viewModel: PriceListListPdfViewModel;
}

/** Landscape — Code/Name/Distributor/both dates/Lines/Status together would cramp badly in Portrait. */
export function PriceListListDocument({ viewModel }: PriceListListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="price lists"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
