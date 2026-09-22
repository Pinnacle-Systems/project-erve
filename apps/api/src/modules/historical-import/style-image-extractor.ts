// Style image extraction (H1 plan §9/§4 corrected review). PDF/source-
// oriented only — this module has NO database access at all, and never
// looks up or compares against a Style's existing image; that DB-aware
// disposition (UPLOAD/SKIP_ALREADY_PRESENT/REVIEW_CONFLICT/MANUAL_REVIEW)
// is computed later, in reconciliation.service.ts, against the candidate
// this module produces.
//
// Primary method (EMBEDDED_IMAGE): every observed AW25/SS26 document embeds
// the garment photo as a real image XObject alongside ~5 small care-symbol
// icons. Candidate selection is by on-page area (points², from the CTM
// placing each image, computed once in pdf-document-session.ts), not
// "largest embedded image wins" alone — the icons and the garment photo
// are separated by roughly two orders of magnitude in area on every
// observed document, giving a comfortable, documented threshold rather
// than a bare "biggest wins" rule. The actual pixel data is recovered by
// rendering the page through pdfjs's own renderer (avoids re-implementing
// PDF image-stream decoding — DCT/Flate/indexed-color/SMask handling all
// already work correctly there) at a resolution calibrated to the located
// image's native pixel density, then cropping to its CTM-derived bounding
// box.
//
// Fallback (TEMPLATE_CROP): if no image XObject clears the area threshold
// (e.g. a flattened/scanned page), crop a fixed region derived from the
// same text anchors the parser uses (between the header grid's bottom edge
// and the style/size table's top edge, right-hand portion of the page) —
// never a raw fixed pixel box independent of the document's own layout.
//
// Takes an already-open PdfDocumentSession rather than raw PDF bytes — see
// pdf-document-session.ts's module comment for why a second pdfjs session
// against the same bytes must be avoided.
import { createHash } from 'node:crypto';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import type { PdfDocumentSession, PlacedImage } from './pdf-document-session.js';

export type ImageExtractionMethod = 'EMBEDDED_IMAGE' | 'TEMPLATE_CROP' | 'MANUAL_REVIEW';

export interface ExtractedImageCandidate {
  method: ImageExtractionMethod;
  pageNumber: number;
  /** PNG bytes of the extracted/cropped candidate — null only when method is MANUAL_REVIEW. */
  imageBytes: Buffer | null;
  widthPx: number | null;
  heightPx: number | null;
  sha256: string | null;
  notes: string[];
}

/** Icons on the observed template are ~200-400pt² on-page; the garment photo is ~9000-10000pt² — comfortably separated by roughly two orders of magnitude, so this threshold is not a bare "largest wins" rule. */
const MIN_GARMENT_IMAGE_AREA_POINTS = 2000;
/** Cap on render scale (≈ points-to-pixels factor) so an unusually large intrinsic image can't blow up memory/output size chasing native resolution. */
const MAX_RENDER_SCALE = 10;
/** Floor render scale for the TEMPLATE_CROP fallback (≈ 288 DPI) — good print-review quality without an oversized file. */
const FALLBACK_RENDER_SCALE = 4;
/** Longest-side cap (px) for the final normalized PNG, applied via sharp. */
const MAX_OUTPUT_DIMENSION = 2000;

type Bbox = { x0: number; y0: number; x1: number; y1: number };

function pdfSpaceArea(bbox: Bbox): number {
  return (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0);
}

/** The expected garment-photo region for the TEMPLATE_CROP fallback: below the header grid's lowest value row, above the style/size table's header row, right-hand portion of the page — derived from the same text anchors the parser uses, never a raw fixed pixel box. */
function anchorDerivedFallbackRegion(layout: PdfDocumentSession['layout']): Bbox | null {
  const tableHeaderLine = layout.lines.find(
    (line) => line.items[0]?.text === 'Style' && line.items.some((item) => item.text === 'Total'),
  );
  if (!tableHeaderLine) return null;
  const y1 = tableHeaderLine.y + 5; // just above the table header
  const y0 = Math.min(layout.height - 40, tableHeaderLine.y + 170); // header-grid block height on the observed template
  const x0 = layout.width * 0.55;
  const x1 = layout.width - 20;
  if (y0 <= y1) return null;
  return { x0, y0, x1, y1 };
}

function cropCanvasRegion(canvas: Canvas, scale: number, pageHeightPoints: number, bbox: Bbox): Canvas {
  const pxX = Math.max(0, Math.round(bbox.x0 * scale));
  const pxYTop = Math.max(0, Math.round((pageHeightPoints - bbox.y1) * scale));
  const pxW = Math.min(canvas.width - pxX, Math.round((bbox.x1 - bbox.x0) * scale));
  const pxH = Math.min(canvas.height - pxYTop, Math.round((bbox.y1 - bbox.y0) * scale));
  const cropped = createCanvas(Math.max(1, pxW), Math.max(1, pxH));
  cropped.getContext('2d').drawImage(canvas, pxX, pxYTop, pxW, pxH, 0, 0, pxW, pxH);
  return cropped;
}

function selectGarmentCandidate(placedImages: PlacedImage[]): PlacedImage | undefined {
  return placedImages
    .filter((img) => pdfSpaceArea(img.bboxPdf) >= MIN_GARMENT_IMAGE_AREA_POINTS)
    .sort((a, b) => pdfSpaceArea(b.bboxPdf) - pdfSpaceArea(a.bboxPdf))[0];
}

export async function extractStyleImageCandidate(session: PdfDocumentSession): Promise<ExtractedImageCandidate> {
  const notes: string[] = [];
  const { layout, placedImages } = session;
  const garmentCandidate = selectGarmentCandidate(placedImages);

  let method: ImageExtractionMethod;
  let cropBbox: Bbox | null;
  let renderScale: number;

  if (garmentCandidate) {
    method = 'EMBEDDED_IMAGE';
    cropBbox = garmentCandidate.bboxPdf;
    const bboxWidthPoints = garmentCandidate.bboxPdf.x1 - garmentCandidate.bboxPdf.x0;
    const nativeScale = bboxWidthPoints > 0 ? garmentCandidate.intrinsicWidthPx / bboxWidthPoints : FALLBACK_RENDER_SCALE;
    renderScale = Math.min(MAX_RENDER_SCALE, Math.max(FALLBACK_RENDER_SCALE, nativeScale));
    notes.push(
      `Selected embedded image ${garmentCandidate.objId} (${garmentCandidate.intrinsicWidthPx}x${garmentCandidate.intrinsicHeightPx}px, ${pdfSpaceArea(garmentCandidate.bboxPdf).toFixed(0)}pt² on page) among ${placedImages.length} image XObject(s)`,
    );
  } else if (placedImages.length > 0) {
    notes.push(
      `${placedImages.length} image XObject(s) found but none exceeded the ${MIN_GARMENT_IMAGE_AREA_POINTS}pt² garment-photo area threshold (largest: ${Math.max(...placedImages.map((i) => pdfSpaceArea(i.bboxPdf))).toFixed(0)}pt²) — falling back to template crop`,
    );
    method = 'TEMPLATE_CROP';
    cropBbox = anchorDerivedFallbackRegion(layout);
    renderScale = FALLBACK_RENDER_SCALE;
    if (!cropBbox) notes.push('Could not locate the expected garment-image region anchors either');
  } else {
    notes.push('No image XObjects found on the page — likely a flattened/scanned document');
    method = 'TEMPLATE_CROP';
    cropBbox = anchorDerivedFallbackRegion(layout);
    renderScale = FALLBACK_RENDER_SCALE;
    if (!cropBbox) notes.push('Could not locate the expected garment-image region anchors either');
  }

  if (!cropBbox) {
    return { method: 'MANUAL_REVIEW', pageNumber: 1, imageBytes: null, widthPx: null, heightPx: null, sha256: null, notes };
  }

  const canvas = await session.renderPageToCanvas(renderScale);
  const cropped = cropCanvasRegion(canvas, renderScale, layout.height, cropBbox);
  const rawPng = await cropped.encode('png');

  const normalized = await sharp(rawPng)
    .resize({ width: MAX_OUTPUT_DIMENSION, height: MAX_OUTPUT_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const metadata = await sharp(normalized).metadata();
  const sha256 = createHash('sha256').update(normalized).digest('hex');

  return {
    method,
    pageNumber: 1,
    imageBytes: normalized,
    widthPx: metadata.width ?? null,
    heightPx: metadata.height ?? null,
    sha256,
    notes,
  };
}
