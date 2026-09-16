import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { DispatchOrderListPdfRow, DispatchOrderListPdfViewModel } from './buildDispatchOrderListViewModel.js';

const columns: PdfTableColumn<DispatchOrderListPdfRow>[] = [
  { key: 'saleOrderNumber', header: 'Dispatch Order No.', width: '13%', value: (row) => row.saleOrderNumber },
  { key: 'distributorsDisplay', header: 'Distributors', width: '27%', value: (row) => row.distributorsDisplay },
  { key: 'factoryName', header: 'Factory', width: '14%', value: (row) => row.factoryName },
  { key: 'soDate', header: 'Date', width: '10%', value: (row) => row.soDate },
  { key: 'financialYearCode', header: 'FY', width: '8%', value: (row) => row.financialYearCode },
  { key: 'destinationCount', header: 'Destinations', width: '10%', align: 'right', value: (row) => row.destinationCount },
  { key: 'totalQuantity', header: 'Total Qty', width: '9%', align: 'right', value: (row) => row.totalQuantity },
  { key: 'stateLabel', header: 'State', width: '9%', value: (row) => row.stateLabel },
];

export interface DispatchOrderListDocumentProps {
  viewModel: DispatchOrderListPdfViewModel;
}

/** Landscape — 8 columns (Dispatch Order No., Distributors, Factory, Date, FY, Destinations, Total Qty, State) would cramp badly in Portrait. */
export function DispatchOrderListDocument({ viewModel }: DispatchOrderListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Dispatch Orders"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
