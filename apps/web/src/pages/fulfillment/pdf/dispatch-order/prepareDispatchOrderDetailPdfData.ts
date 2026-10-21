import { resolveImagesForPdf, type PdfImageRef } from '../../../../lib/pdf/images.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import type { DispatchOrderDetailPdfViewModel } from './buildDispatchOrderDetailViewModel.js';

/** Resolve only primary images, with one export-local cache keyed by file ID.
 * The shared resolver deduplicates repeated rows and degrades failures to placeholders.
 */
export async function prepareDispatchOrderDetailPdfData(
  viewModel: DispatchOrderDetailPdfViewModel,
): Promise<Map<string, PdfImageSource>> {
  const rows = [
    ...viewModel.distributorGroups.flatMap((group) =>
      group.destinations.flatMap((dest) => dest.styleRows),
    ),
    ...viewModel.overallStyleRows,
  ];
  const refs = rows
    .map((row) => row.primaryImage)
    .filter((ref): ref is PdfImageRef => ref !== null);
  return resolveImagesForPdf(refs, { maxDimension: 160 });
}
