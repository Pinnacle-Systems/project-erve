import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { JobOrderListPdfRow, JobOrderListPdfViewModel } from './buildJobOrderListViewModel.js';

const columns: PdfTableColumn<JobOrderListPdfRow>[] = [
  { key: 'jobOrderNumber', header: 'Job Order No.', width: '13%', value: (row) => row.jobOrderNumber },
  { key: 'styleDisplay', header: 'Style', width: '20%', value: (row) => row.styleDisplay },
  { key: 'factoryName', header: 'Factory', width: '14%', value: (row) => row.factoryName },
  {
    key: 'sourceOrderSheetCount',
    header: 'Order Sheets',
    width: '8%',
    align: 'right',
    value: (row) => row.sourceOrderSheetCount,
  },
  { key: 'requiredDeliveryDate', header: 'Delivery Date', width: '10%', value: (row) => row.requiredDeliveryDate },
  {
    key: 'orderedQuantityTotal',
    header: 'Ordered',
    width: '9%',
    align: 'right',
    value: (row) => row.orderedQuantityTotal,
  },
  {
    key: 'preparedQuantityTotal',
    header: 'Prepared',
    width: '9%',
    align: 'right',
    value: (row) => row.preparedQuantityTotal,
  },
  { key: 'status', header: 'Status', width: '17%', value: (row) => row.status },
];

export interface JobOrderListDocumentProps {
  viewModel: JobOrderListPdfViewModel;
}

/** Landscape — 8 columns (Job Order, Style, Factory, Order Sheets, Delivery Date, both quantities, Status) would cramp badly in Portrait. */
export function JobOrderListDocument({ viewModel }: JobOrderListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Job Orders"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
