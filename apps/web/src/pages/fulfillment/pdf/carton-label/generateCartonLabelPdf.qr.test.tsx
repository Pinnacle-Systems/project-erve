import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { generateCartonLabelPdfBlob } from './generateCartonLabelPdf.js';
import type { CartonLabelSource } from './buildCartonLabelViewModel.js';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
function source(token: string, styles = 1): CartonLabelSource {
  return {
    saleOrderNumber: 'DO/26-27/1',
    factoryName: 'SECRET FACTORY',
    factoryDispatchNumber: 'SECRET FD',
    carton: {
      id: 'carton-one',
      cartonNumber: 'C1',
      version: 1,
      auditState: 'INSPECTED',
      retired: false,
      totalQuantity: styles * 11,
      lines: Array.from({ length: styles * 11 }, (_, index) => ({
        saleOrderLineId: `line-${index}`,
        styleId: `style-${Math.floor(index / 11)}`,
        styleNumber: `STYLE-${Math.floor(index / 11)}`,
        styleName: 'Long style description',
        primaryImage: null,
        sizeId: `size-${index % 11}`,
        sizeCode: `SZ${(index % 11) + 1}`,
        sizeLabel: `Size ${(index % 11) + 1}`,
        sizeSortOrder: index % 11,
        quantity: 1,
      })),
    } as CartonLabelSource['carton'],
    destination: {
      label: 'Destination',
      distributor: { name: 'Distributor' },
      addressLine1:
        'A very long destination address that must remain readable beside carton contents',
      city: 'Chennai',
      state: 'Tamil Nadu',
      country: 'India',
      postalCode: '600001',
    } as CartonLabelSource['destination'],
    deliveryQr: {
      url: `https://delivery.example/delivery/carton#${token}`,
      labelReference: 'CARTON-REFERENCE',
    },
  };
}
describe('QR in the existing contents PDF', () => {
  it.each([1, 35])(
    'decodes the exact QR from a 300dpi raster with %s Style rows and preserves content',
    async (styles) => {
      // Canonical 256-bit base64url with mixed case/punctuation, matching real
      // token density rather than QR's more compact all-uppercase encoding.
      const token = Buffer.from(
        Uint8Array.from({ length: 32 }, (_, index) => (index * 79 + 13) % 256),
      ).toString('base64url');
      const input = source(token, styles);
      const blob = await generateCartonLabelPdfBlob(input, { generatedAt: '2026-11-05T00:00:00Z' });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: bytes.slice(), useSystemFonts: true });
      try {
        const document = await task.promise;
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 300 / 72 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
          .promise;
        const raster = context.getImageData(0, 0, canvas.width, canvas.height);
        expect(jsQR(new Uint8ClampedArray(raster.data), raster.width, raster.height)?.data).toBe(
          input.deliveryQr!.url,
        );
        const texts = [];
        for (let number = 1; number <= document.numPages; number++) {
          texts.push(
            (await (await document.getPage(number)).getTextContent()).items
              .flatMap((item) => ('str' in item ? [item.str] : []))
              .join(' '),
          );
        }
        const text = texts.join(' ');
        for (const required of [
          'Carton C1',
          'DO/26-27/1',
          'Destination',
          'SZ1',
          'SZ11',
          `Total: ${styles * 11}`,
          'CARTON-REFERENCE',
        ])
          expect(text).toContain(required);
        // ISS-075: the source destination carries a Distributor name; the printed label never does.
        expect(text + JSON.stringify(await document.getMetadata())).not.toMatch(/SECRET|AAAAAA|Distributor/);
        if (styles > 1) expect(document.numPages).toBeGreaterThan(1);
        if (process.env.CARTON_QR_EVIDENCE_DIR) {
          const directory = resolve(process.env.CARTON_QR_EVIDENCE_DIR);
          await mkdir(directory, { recursive: true });
          await writeFile(resolve(directory, `carton-qr-${styles}-styles.pdf`), bytes);
          await writeFile(
            resolve(directory, `carton-qr-${styles}-styles.png`),
            canvas.toBuffer('image/png'),
          );
        }
      } finally {
        await task.destroy();
      }
    },
    30000,
  );
  it('fails closed on malformed QR input rather than printing a placeholder', async () => {
    const input = source('bad-token');
    await expect(
      generateCartonLabelPdfBlob(input, { generatedAt: '2026-11-05T00:00:00Z' }),
    ).rejects.toThrow(/QR/);
  });
});
