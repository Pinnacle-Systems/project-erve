import {
  buildErvePackingListDetailViewModel,
  type ErvePackingListDetailPdfMeta,
} from './buildErvePackingListDetailViewModel.js';
import { ErvePackingListDetailDocument } from './ErvePackingListDetailDocument.js';
import { renderPdfBlob } from '../../../../lib/pdf/generate.js';
import type { ErvePackingListDetail } from '../../types.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The unchanged Phase 3D rendering pipeline, called inside the dedicated worker.
 * The already-authorized detail record is passed by the UI; no extra fetch or DOM access here.
 */
export async function renderErvePackingListDetailPdfBlob(
  packingList: ErvePackingListDetail,
  meta: ErvePackingListDetailPdfMeta,
): Promise<Blob> {
  const viewModel = buildErvePackingListDetailViewModel(packingList, meta);
  const merged = await PDFDocument.create();
  const batchSize = 10;
  // One empty batch preserves the OPEN / no-cartons document. Await each render/copy
  // before creating the next renderer; never retain an array of intermediate blobs.
  for (let start = 0; start < Math.max(viewModel.cartons.length, 1); start += batchSize) {
    const blob = await renderPdfBlob(
      <ErvePackingListDetailDocument
        viewModel={{ ...viewModel, cartons: viewModel.cartons.slice(start, start + batchSize) }}
        first={start === 0}
        last={start + batchSize >= viewModel.cartons.length}
      />,
    );
    const batch = await PDFDocument.load(await blob.arrayBuffer());
    if (batch.getPageCount() === 0) throw new Error('Packing list PDF batch has no pages');
    for (const page of await merged.copyPages(batch, batch.getPageIndices())) merged.addPage(page);
  }
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const pageCount = merged.getPageCount();
  for (const [index, page] of merged.getPages().entries()) {
    const text = `Page ${index + 1} of ${pageCount}`;
    page.drawText(text, {
      x: (page.getWidth() - font.widthOfTextAtSize(text, 8)) / 2,
      // Original PdfFooter baseline, measured in Phase 3C; body reserves 40pt.
      y: 18.099987,
      size: 8,
      font,
      color: rgb(119 / 255, 119 / 255, 119 / 255),
    });
  }
  // Rejection at any stage propagates to usePdfAction; an incomplete Blob never escapes.
  const bytes = await merged.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}
