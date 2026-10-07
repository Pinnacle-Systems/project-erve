import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PriceListDetailPdfViewModel } from './buildPriceListDetailViewModel.js';

export interface PriceListDetailDocumentProps {
  viewModel: PriceListDetailPdfViewModel;
}

/** Portrait — a single identity/percentage key-value section needs no table. */
export function PriceListDetailDocument({ viewModel }: PriceListDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Price List Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={3} />
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
