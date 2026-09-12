import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type { PriceListDetailLineRow, PriceListDetailPdfViewModel } from './buildPriceListDetailViewModel.js';

const lineColumns: PdfTableColumn<PriceListDetailLineRow>[] = [
  { key: 'styleNumber', header: 'Style Number', width: '20%', value: (row) => row.styleNumber },
  { key: 'styleName', header: 'Style Name', width: '50%', value: (row) => row.styleName },
  { key: 'unitPrice', header: 'Unit Price', width: '30%', align: 'right', value: (row) => row.unitPrice },
];

export interface PriceListDetailDocumentProps {
  viewModel: PriceListDetailPdfViewModel;
}

/** Portrait — a 3-column style/price table reads comfortably without cramping. */
export function PriceListDetailDocument({ viewModel }: PriceListDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Price List Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={3} />
      </PdfSection>

      <PdfSection title="Style Prices" wrap>
        <PdfTable columns={lineColumns} rows={viewModel.lines} rowKey={(row) => row.id} />
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
