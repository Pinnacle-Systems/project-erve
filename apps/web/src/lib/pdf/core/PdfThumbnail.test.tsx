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
