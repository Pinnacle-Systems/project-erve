import { afterEach, describe, expect, it, vi } from 'vitest';
import { issuedTaxInvoiceFixture } from './taxInvoicePdfFixture.js';
import { prepareTaxInvoicePdfData } from './prepareTaxInvoicePdfData.js';

const resolve = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());
const png = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/pdf/images.js', async (original) => ({
  ...(await original<typeof import('../../../../lib/pdf/images.js')>()),
  resolveImagesForPdf: resolve,
}));
vi.mock('../../../../lib/api-client.js', () => ({ apiClient: { get: read } }));
vi.mock('./resizeInvoicePdfPng.js', () => ({ resizeInvoicePdfPng: png }));
afterEach(() => {
  resolve.mockReset();
  read.mockReset();
  png.mockReset();
});

describe('Tax Invoice archived PDF images', () => {
  it('preserves PNG transparency through a lossless, authenticated archive read', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.image = {
      id: 'alpha-1',
      mimeType: 'image/png',
      sizeBytes: 100,
      checksumSha256: 'a'.repeat(64),
    };
    const blob = new Blob(['alpha'], { type: 'image/png' });
    read.mockResolvedValue({ data: blob });
    png.mockResolvedValue('data:image/png;base64,alpha-preserved');
    const model = await prepareTaxInvoicePdfData(invoice);
    expect(read).toHaveBeenCalledWith(
      '/tax-invoices/inv-1/images/alpha-1/content',
      expect.objectContaining({ responseType: 'blob', timeout: 8000 }),
    );
    expect(png).toHaveBeenCalledWith(blob, 600);
    expect(resolve).not.toHaveBeenCalled();
    expect(model.groups[0]?.image).toEqual({ dataUri: 'data:image/png;base64,alpha-preserved' });
  });
  it('reads only invoice-owned image references with print-quality settings', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.image = {
      id: 'archive-1',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      checksumSha256: 'a'.repeat(64),
    };
    resolve.mockResolvedValue(
      new Map([['archive-1', { dataUri: 'data:image/png;base64,issued' }]]),
    );
    const model = await prepareTaxInvoicePdfData(invoice);
    expect(resolve).toHaveBeenCalledWith(
      [{ id: 'archive-1', path: '/tax-invoices/inv-1/images/archive-1/content' }],
      expect.objectContaining({ maxDimension: 600, quality: 0.92, concurrency: 4 }),
    );
    expect(model.groups[0]?.image).toEqual({ dataUri: 'data:image/png;base64,issued' });
  });
  it('does not fetch or recreate unavailable historical media', async () => {
    const model = await prepareTaxInvoicePdfData(
      issuedTaxInvoiceFixture({ documentSnapshot: null }),
    );
    expect(resolve).not.toHaveBeenCalled();
    expect(model.groups[0]?.image).toEqual({ inconsistent: true });
  });
  it('keeps failed archived-image reads honest without substituting a current master image', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.image = {
      id: 'archive-1',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      checksumSha256: 'a'.repeat(64),
    };
    resolve.mockResolvedValue(new Map([['archive-1', { placeholder: true }]]));
    expect((await prepareTaxInvoicePdfData(invoice)).groups[0]?.image).toEqual({
      inconsistent: true,
    });
  });
  it('uses the same issued image after current Style presentation changes', async () => {
    const invoice = issuedTaxInvoiceFixture();
    invoice.documentSnapshot!.lines[0]!.image = {
      id: 'archive-1',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      checksumSha256: 'a'.repeat(64),
    };
    resolve.mockResolvedValue(
      new Map([['archive-1', { dataUri: 'data:image/png;base64,issued' }]]),
    );
    const first = await prepareTaxInvoicePdfData(invoice);
    invoice.lines[0]!.style.styleNumber = 'REPLACED-CURRENT-MASTER';
    expect((await prepareTaxInvoicePdfData(invoice)).groups[0]).toEqual(first.groups[0]);
    expect(resolve.mock.calls.every(([refs]) => !JSON.stringify(refs).includes('/styles/'))).toBe(
      true,
    );
  });
});
