import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { DistributorDetailPdfViewModel } from './buildDistributorDetailViewModel.js';

export interface DistributorDetailDocumentProps {
  viewModel: DistributorDetailPdfViewModel;
}

/** Portrait by design, pure render — no HTTP, no business logic, no form chrome. */
export function DistributorDetailDocument({ viewModel }: DistributorDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Distributor Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={3} />
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
