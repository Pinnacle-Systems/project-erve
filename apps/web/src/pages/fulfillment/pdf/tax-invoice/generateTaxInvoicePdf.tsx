import type { TaxInvoiceView } from '@erve/types';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import { prepareTaxInvoicePdfData } from './prepareTaxInvoicePdfData.js';
import { TaxInvoiceDocument } from './TaxInvoiceDocument.js';

/** Loaded lazily by finalized-only actions; both Print and Download use the same frozen data. */
export async function generateTaxInvoicePdfBlob(invoice: TaxInvoiceView): Promise<Blob> {
  const viewModel = await prepareTaxInvoicePdfData(invoice);
  return renderPdfBlob(<TaxInvoiceDocument viewModel={viewModel} />);
}
