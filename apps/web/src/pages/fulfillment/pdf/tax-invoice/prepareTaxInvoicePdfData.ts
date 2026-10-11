import type { TaxInvoiceView } from '@erve/types';
import { resolveImagesForPdf, runWithConcurrency } from '../../../../lib/pdf/images.js';
import { apiClient } from '../../../../lib/api-client.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { buildTaxInvoiceViewModel } from './buildTaxInvoiceViewModel.js';
import { resizeInvoicePdfPng } from './resizeInvoicePdfPng.js';

/** The only network stage: existing authenticated reads of frozen invoice archives. */
export async function prepareTaxInvoicePdfData(invoice: TaxInvoiceView) {
  const model = buildTaxInvoiceViewModel(invoice);
  const imageIds = [
    ...new Set(model.groups.flatMap((group) => (group.imageId ? [group.imageId] : []))),
  ];
  if (imageIds.length === 0) return model;
  const refs = imageIds.map((id) => ({
    id,
    path: `/tax-invoices/${encodeURIComponent(invoice.id)}/images/${encodeURIComponent(id)}/content`,
    mimeType: invoice.documentSnapshot!.lines.find((line) => line.image?.id === id)!.image!
      .mimeType,
  }));
  const lossless = refs.filter((ref) => ['image/png', 'image/webp'].includes(ref.mimeType));
  const jpeg = refs.filter((ref) => !['image/png', 'image/webp'].includes(ref.mimeType));
  const images = jpeg.length
    ? await resolveImagesForPdf(
        jpeg.map(({ id, path }) => ({ id, path })),
        { maxDimension: 600, quality: 0.92, concurrency: 4 },
      )
    : new Map<string, PdfImageSource>();
  await runWithConcurrency(lossless, 4, async (ref) => {
    try {
      const response = await apiClient.get<Blob>(ref.path, { responseType: 'blob', timeout: 8000 });
      images.set(ref.id, { dataUri: await resizeInvoicePdfPng(response.data, 600) });
    } catch {
      images.set(ref.id, { inconsistent: true });
    }
  });
  return buildTaxInvoiceViewModel(invoice, images);
}
