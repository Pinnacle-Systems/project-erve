import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfFilterSummary } from '../../../lib/pdf/core/PdfFilterSummary.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { OrderSheetListPdfRow, OrderSheetListPdfViewModel } from './buildOrderSheetListViewModel.js';

const columns: PdfTableColumn<OrderSheetListPdfRow>[] = [
  { key: 'poNumber', header: 'Order Sheet No.', width: '12%', value: (row) => row.poNumber },
  { key: 'distributorName', header: 'Distributor', width: '13%', value: (row) => row.distributorName },
  { key: 'styleNumber', header: 'Style No.', width: '9%', value: (row) => row.styleNumber },
  { key: 'styleName', header: 'Style Name', width: '15%', value: (row) => row.styleName },
  { key: 'purchaseMode', header: 'Mode', width: '9%', value: (row) => row.purchaseMode },
  { key: 'poDate', header: 'Order Date', width: '8%', value: (row) => row.poDate },
  { key: 'requiredDeliveryDate', header: 'Delivery Date', width: '8%', value: (row) => row.requiredDeliveryDate },
  {
    key: 'totalOrderedQuantity',
    header: 'Qty',
    width: '7%',
    align: 'right',
    value: (row) => row.totalOrderedQuantity,
  },
  { key: 'planningState', header: 'Planning State', width: '11%', value: (row) => row.planningState },
  { key: 'jobOrderNumber', header: 'Job Order', width: '8%', value: (row) => row.jobOrderNumber },
];

export interface OrderSheetListDocumentProps {
  viewModel: OrderSheetListPdfViewModel;
}

/** Landscape — 10 columns (Order Sheet, Distributor, Style, Mode, both dates, Qty, Planning State, Job Order) would cramp badly in Portrait. */
export function OrderSheetListDocument({ viewModel }: OrderSheetListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection
        generatedAt={viewModel.generatedAt}
        generatedBy={viewModel.generatedBy}
        totalCount={viewModel.totalCount}
        recordLabel="Order Sheets"
      />
      <PdfFilterSummary filters={viewModel.filters} />
      <PdfTable columns={columns} rows={viewModel.rows} rowKey={(row) => row.id} />
      <PdfFooter />
    </PdfDocument>
  );
}
