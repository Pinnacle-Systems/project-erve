import { Text } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type {
  ErveDispatchDetailInvoiceHandoffRow,
  ErveDispatchDetailPdfViewModel,
  ErveDispatchDetailSaleOrReturnRow,
} from './buildErveDispatchDetailViewModel.js';

const invoiceHandoffColumns: PdfTableColumn<ErveDispatchDetailInvoiceHandoffRow>[] = [
  { key: 'modeLabel', header: 'Mode', width: '15%', value: (row) => row.modeLabel },
  { key: 'styleDisplay', header: 'Style / Size', width: '30%', value: (row) => row.styleDisplay },
  { key: 'quantity', header: 'Qty', width: '10%', align: 'right', value: (row) => row.quantity },
  { key: 'statusLabel', header: 'Invoice Status', width: '20%', value: (row) => row.statusLabel },
  { key: 'tallyInvoiceNumber', header: 'Tally Invoice #', width: '25%', value: (row) => row.tallyInvoiceNumber },
];

const saleOrReturnColumns: PdfTableColumn<ErveDispatchDetailSaleOrReturnRow>[] = [
  { key: 'styleDisplay', header: 'Style / Size', width: '20%', value: (row) => row.styleDisplay },
  { key: 'dispatchedQuantity', header: 'Dispatched', width: '10%', align: 'right', value: (row) => row.dispatchedQuantity },
  { key: 'receivedQuantity', header: 'Received', width: '10%', align: 'right', value: (row) => row.receivedQuantity },
  { key: 'actualSoldQuantity', header: 'Actual Sold', width: '10%', align: 'right', value: (row) => row.actualSoldQuantity },
  { key: 'returnedQuantity', header: 'Returned', width: '10%', align: 'right', value: (row) => row.returnedQuantity },
  { key: 'approvedAwaitingReceiptQuantity', header: 'Approved (Awaiting)', width: '13%', align: 'right', value: (row) => row.approvedAwaitingReceiptQuantity },
  { key: 'pendingRequestedQuantity', header: 'Pending Request', width: '12%', align: 'right', value: (row) => row.pendingRequestedQuantity },
  { key: 'remainingWithDistributor', header: 'Remaining', width: '15%', align: 'right', value: (row) => row.remainingWithDistributor },
];

export interface ErveDispatchDetailDocumentProps {
  viewModel: ErveDispatchDetailPdfViewModel;
}

/** Landscape — the identity grid plus Invoice/Tally Status (5 cols) and Sale-or-Return Position (8 cols) tables read far better wide. */
export function ErveDispatchDetailDocument({ viewModel }: ErveDispatchDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Dispatch Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
      </PdfSection>

      <PdfSection title="Delivery">
        <PdfKeyValueSection items={viewModel.deliveryItems} columns={2} />
      </PdfSection>

      {viewModel.invoiceHandoffs ? (
        <PdfSection title="Invoice / Tally Status" wrap>
          {viewModel.invoiceHandoffs.length > 0 ? (
            <PdfTable columns={invoiceHandoffColumns} rows={viewModel.invoiceHandoffs} rowKey={(row) => row.invoiceHandoffId} />
          ) : (
            <Text>No invoice handoffs.</Text>
          )}
        </PdfSection>
      ) : (
        <PdfSection title="Invoice / Tally Status">
          <Text>Not available for this viewer.</Text>
        </PdfSection>
      )}

      {viewModel.saleOrReturnLines.length > 0 ? (
        <PdfSection title="Sale-or-Return Position" wrap>
          <PdfTable columns={saleOrReturnColumns} rows={viewModel.saleOrReturnLines} rowKey={(row) => row.saleOrderLineId} />
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
