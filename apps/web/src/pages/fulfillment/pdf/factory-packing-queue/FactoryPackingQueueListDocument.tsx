import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type {
  FactoryPackingQueueAwaitingRow,
  FactoryPackingQueueDispatchRow,
  FactoryPackingQueueListPdfViewModel,
} from './buildFactoryPackingQueueListViewModel.js';

const awaitingColumns: PdfTableColumn<FactoryPackingQueueAwaitingRow>[] = [
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '15%', value: (row) => row.saleOrderNumber },
  { key: 'distributorName', header: 'Distributor', width: '18%', value: (row) => row.distributorName },
  { key: 'styleDisplay', header: 'Style', width: '27%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '10%', value: (row) => row.sizeLabel },
  { key: 'allocatedQuantity', header: 'Required', width: '10%', align: 'right', value: (row) => row.allocatedQuantity },
  { key: 'packedQuantity', header: 'Packed', width: '10%', align: 'right', value: (row) => row.packedQuantity },
  { key: 'remainingQuantity', header: 'Remaining', width: '10%', align: 'right', value: (row) => row.remainingQuantity },
];

const dispatchColumns: PdfTableColumn<FactoryPackingQueueDispatchRow>[] = [
  { key: 'factoryDispatchNumber', header: 'Dispatch #', width: '20%', value: (row) => row.factoryDispatchNumber },
  { key: 'saleOrderNumber', header: 'Dispatch Order', width: '20%', value: (row) => row.saleOrderNumber },
  { key: 'distributorsDisplay', header: 'Distributors', width: '35%', value: (row) => row.distributorsDisplay },
  { key: 'statusLabel', header: 'Status', width: '15%', value: (row) => row.statusLabel },
  { key: 'consolidated', header: 'Consolidated', width: '10%', value: (row) => row.consolidated },
];

export interface FactoryPackingQueueListDocumentProps {
  viewModel: FactoryPackingQueueListPdfViewModel;
}

/** Landscape — the 7-column Awaiting Packing table would cramp badly in Portrait. */
export function FactoryPackingQueueListDocument({ viewModel }: FactoryPackingQueueListDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title={`Awaiting Packing (${viewModel.awaitingPackingCount})`} wrap>
        <PdfTable columns={awaitingColumns} rows={viewModel.awaitingPacking} rowKey={(row) => row.id} />
      </PdfSection>

      <PdfSection title={`Your Factory Dispatches (${viewModel.factoryDispatchCount})`} wrap>
        <PdfTable columns={dispatchColumns} rows={viewModel.factoryDispatches} rowKey={(row) => row.id} />
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
