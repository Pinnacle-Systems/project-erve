import { Document, Page, pdf } from '@react-pdf/renderer';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { PdfThumbnail, type PdfImageSource } from './PdfThumbnail.js';
import { createSolidColorPngDataUri } from '../../../test-support/solid-color-png.js';

async function renders(image: PdfImageSource | null | undefined): Promise<void> {
  const blob = await pdf(
    <Document>
      <Page>
        <PdfThumbnail image={image} width={90} height={90} />
      </Page>
    </Document>,
  ).toBlob();
  expect(blob.size).toBeGreaterThan(0);
}

interface RenderedImage {
  width: number;
  height: number;
}

/** Renders a single PdfThumbnail to a real PDF and reads back the image's own paint-time CTM. */
async function renderThumbnailImage(
  image: PdfImageSource,
  box: { width: number; height: number },
): Promise<RenderedImage | null> {
  const blob = await pdf(
    <Document>
      <Page>
        <PdfThumbnail image={image} width={box.width} height={box.height} />
      </Page>
    </Document>,
  ).toBlob();
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const ops = await page.getOperatorList();
    const paintIndex = ops.fnArray.indexOf(OPS.paintImageXObject);
    if (paintIndex === -1) return null;
    let transformIndex = -1;
    for (let i = paintIndex - 1; i >= 0; i -= 1) {
      if (ops.fnArray[i] === OPS.transform) {
        transformIndex = i;
        break;
      }
    }
    const matrix = ops.argsArray[transformIndex] as number[];
    return { width: Math.abs(matrix[0]!), height: Math.abs(matrix[3]!) };
  } finally {
    await task.destroy();
  }
}

describe('PdfThumbnail', () => {
  it('preserves the source aspect ratio inside a fixed image box', () => {
    const image = { dataUri: 'data:image/png;base64,iVBORw0KGgo=' };
    const rendered = PdfThumbnail({ image, width: 120, height: 120 });

    // Explicit contain fitting is essential: fixed width and height alone
    // stretch the portrait product photograph into a square in exported PDFs.
    expect(rendered.props.src).toBe(image.dataUri);
    expect(rendered.props.style).toEqual({
      width: 120,
      height: 120,
      objectFit: 'contain',
    });
  });

  it('renders without throwing for every image state', async () => {
    await renders({ dataUri: 'data:image/png;base64,iVBORw0KGgo=' });
    await renders({ placeholder: true });
    // The explicit "data inconsistent" marker (resolveJobOrderPrimaryStyle's
    // defensive branch) must render as its own distinct state, never throw
    // and never silently fall through to the plain "no image" placeholder.
    await renders({ inconsistent: true });
    await renders(null);
    await renders(undefined);
  });
});

// ---------------------------------------------------------------------------
// PDF-AR-001: PR #94 added `objectFit: 'contain'` (asserted on the component's
// style object above), but no test had ever rendered a real, non-square image
// through `@react-pdf/renderer` and read back what was actually painted. These
// tests use deterministic fixtures (see createSolidColorPngDataUri) with
// distinct, known pixel dimensions and inspect the image's own paint-time CTM
// via pdfjs-dist — the same technique used for ISS-043's logo-sizing tests —
// to prove aspect ratio holds and bounds never exceed the thumbnail box, not
// just that the right style object is passed.
// ---------------------------------------------------------------------------
describe('PDF-AR-001 rendered aspect ratio', () => {
  const box = { width: 120, height: 120 };

  it('fits a portrait image without stretching it to the square box', async () => {
    const dataUri = createSolidColorPngDataUri(100, 160); // 0.625:1
    const rendered = await renderThumbnailImage({ dataUri }, box);
    expect(rendered).not.toBeNull();
    // Height-bound: full box height, width scaled down to preserve 100/160.
    expect(rendered!.height).toBeCloseTo(box.height, 0);
    expect(rendered!.width).toBeCloseTo(box.height * (100 / 160), 0);
    expect(rendered!.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(rendered!.height).toBeLessThanOrEqual(box.height + 0.5);
  });

  it('fits a landscape image without stretching it to the square box', async () => {
    const dataUri = createSolidColorPngDataUri(200, 90); // 2.22:1
    const rendered = await renderThumbnailImage({ dataUri }, box);
    expect(rendered).not.toBeNull();
    // Width-bound: full box width, height scaled down to preserve 200/90.
    expect(rendered!.width).toBeCloseTo(box.width, 0);
    expect(rendered!.height).toBeCloseTo(box.width * (90 / 200), 0);
    expect(rendered!.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(rendered!.height).toBeLessThanOrEqual(box.height + 0.5);
  });

  it('fills the box exactly for a square image', async () => {
    const dataUri = createSolidColorPngDataUri(150, 150);
    const rendered = await renderThumbnailImage({ dataUri }, box);
    expect(rendered).not.toBeNull();
    expect(rendered!.width).toBeCloseTo(box.width, 0);
    expect(rendered!.height).toBeCloseTo(box.height, 0);
  });

  it('never exceeds the thumbnail box for an extreme aspect ratio', async () => {
    const dataUri = createSolidColorPngDataUri(400, 40); // 10:1, wider than any real Style photo
    const rendered = await renderThumbnailImage({ dataUri }, box);
    expect(rendered).not.toBeNull();
    expect(rendered!.width).toBeLessThanOrEqual(box.width + 0.5);
    expect(rendered!.height).toBeLessThanOrEqual(box.height + 0.5);
  });

  it('paints no image at all for the missing-image and inconsistent fallbacks', async () => {
    expect(await renderThumbnailImage({ placeholder: true }, box)).toBeNull();
    expect(await renderThumbnailImage({ inconsistent: true }, box)).toBeNull();
  });
});
