import { Document, Page, pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PdfThumbnail, type PdfImageSource } from './PdfThumbnail.js';

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
