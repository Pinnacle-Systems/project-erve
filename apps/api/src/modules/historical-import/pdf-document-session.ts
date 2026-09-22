// A single pdfjs-dist document session shared across text-layout parsing,
// operator-list scanning, and page rendering for one PDF.
//
// This exists because of an empirically-confirmed pdfjs-dist 6.x/Node
// quirk: opening a SECOND separate `getDocument()` session against the
// SAME underlying PDF bytes in one process — after the first session was
// already closed — can throw `DOMException [DataCloneError]: Cannot
// transfer object of unsupported type` deep inside pdfjs's internal
// loopback "fake worker" message channel, specifically when the second
// session's first call is `getOperatorList()`. Reproduced in isolation
// (two plain .mjs modules, each with its own `getDocument` import, run
// under both `node` and `tsx`) with the SAME file's bytes across two
// sequential sessions; using two DIFFERENT files' bytes for the two
// sessions does not trigger it. Root cause not fully isolated (pdfjs
// internals), but the fix is straightforward and worth doing anyway: never
// open more than one session per file. Every historical-import module that
// needs pdfjs (the parser, the image extractor) takes an already-open
// session instead of raw bytes.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { linesFromItems, type PageLayout, type TextItem } from './pdf-text-layout.js';

/** Structural shape of pdfjs-dist's TextItem — not re-exported from the legacy build's own .d.mts, so declared locally rather than reaching into its internal types/ tree. */
interface PdfJsTextRun {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function isTextRun(item: object): boolean {
  return 'transform' in item;
}

export interface PlacedImage {
  objId: string;
  intrinsicWidthPx: number;
  intrinsicHeightPx: number;
  /** Bounding box in PDF page space (points), origin bottom-left — same space as pdf-text-layout's TextItem coordinates. */
  bboxPdf: { x0: number; y0: number; x1: number; y1: number };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(m: Matrix, n: Matrix): Matrix {
  // PDF `cm` semantics: newCTM = m × CTM (row-vector convention).
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

// pdfjs's Node/legacy build needs a canvas factory it can use internally
// (masks, patterns, auxiliary surfaces) for rendering — passing this to
// getDocument() avoids handing a raw @napi-rs Canvas across pdfjs's
// internal fake-worker message channel, which structuredClone rejects.
class NodeCanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(canvasAndContext: { canvas: Canvas }, width: number, height: number) {
    canvasAndContext.canvas.width = Math.max(1, width);
    canvasAndContext.canvas.height = Math.max(1, height);
  }
  destroy(canvasAndContext: { canvas: Canvas | null; context: unknown }) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

export interface PdfDocumentSession {
  pageCount: number;
  /** Page 1's reconstructed text layout — every historical PO sheet is expected to be single-page. */
  layout: PageLayout;
  /** Every image XObject painted on page 1, with its on-page bounding box (from the operator list's save/transform/paint/restore sequence). */
  placedImages: PlacedImage[];
  /** Renders page 1 to a canvas at the given points-to-pixels scale. */
  renderPageToCanvas(scale: number): Promise<Canvas>;
  destroy(): Promise<void>;
}

function collectPlacedImages(fnArray: number[], argsArray: unknown[][]): PlacedImage[] {
  const images: PlacedImage[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) {
      stack.push(current);
    } else if (fn === OPS.restore) {
      current = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      const args = argsArray[i] as number[];
      current = multiplyMatrix(args as Matrix, current);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const [objId, w, h] = argsArray[i] as [string, number, number];
      const corners = [
        transformPoint(current, 0, 0),
        transformPoint(current, 1, 0),
        transformPoint(current, 0, 1),
        transformPoint(current, 1, 1),
      ];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      images.push({
        objId,
        intrinsicWidthPx: w,
        intrinsicHeightPx: h,
        bboxPdf: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) },
      });
    }
  }
  return images;
}

/** Opens exactly one pdfjs-dist session for the given PDF bytes. Throws on a genuinely unreadable/corrupt PDF — callers classify that as a parse failure, not a crash. Always call destroy() (e.g. try/finally). */
export async function openPdfDocumentSession(pdfBytes: Uint8Array): Promise<PdfDocumentSession> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's own CanvasFactory/RenderParameters types name DOM globals unavailable in this backend's Node-only tsconfig `lib`.
  const loadingTask = getDocument({ data: pdfBytes, useSystemFonts: true, CanvasFactory: NodeCanvasFactory as any });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const [content, opList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);

  const items: TextItem[] = content.items.filter(isTextRun).map((item) => {
    const run = item as unknown as PdfJsTextRun;
    return { text: run.str, x: run.transform[4]!, y: run.transform[5]!, width: run.width, height: run.height };
  });
  const layout: PageLayout = {
    pageNumber: 1,
    width: viewport.width,
    height: viewport.height,
    lines: linesFromItems(items),
  };
  const placedImages = collectPlacedImages(opList.fnArray as number[], opList.argsArray as unknown[][]);

  return {
    pageCount: doc.numPages,
    layout,
    placedImages,
    async renderPageToCanvas(scale: number) {
      const renderViewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
      const ctx = canvas.getContext('2d');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the module-level comment on RenderParameters' DOM-typed fields.
      await page.render({ canvasContext: ctx, viewport: renderViewport } as any).promise;
      return canvas;
    },
    async destroy() {
      await loadingTask.destroy();
    },
  };
}
