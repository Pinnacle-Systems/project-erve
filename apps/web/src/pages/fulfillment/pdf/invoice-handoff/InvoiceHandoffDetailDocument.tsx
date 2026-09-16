import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { InvoiceHandoffDetailPdfViewModel } from './buildInvoiceHandoffDetailViewModel.js';

export interface InvoiceHandoffDetailDocumentProps {
  viewModel: InvoiceHandoffDetailPdfViewModel;
}

/** Portrait — a single physically-dispatched-line record with two short key/value sections needs no Landscape width. */
export function InvoiceHandoffDetailDocument({ viewModel }: InvoiceHandoffDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Handoff Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={2} />
      </PdfSection>

      <PdfSection title="Tally Reference">
        <PdfKeyValueSection items={viewModel.tallyItems} columns={2} />
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
