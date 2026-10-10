import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceHandoffView } from '../../types.js';
import { prepareInvoiceHandoffDetailPdfData } from './prepareInvoiceHandoffDetailPdfData.js';

const resolveImagesForPdfMock = vi.fn();
vi.mock('../../../../lib/pdf/images.js', () => ({
  resolveImagesForPdf: (...args: unknown[]) => resolveImagesForPdfMock(...args),
}));

afterEach(() => {
  resolveImagesForPdfMock.mockReset();
});

function makeHandoff(overrides: Partial<InvoiceHandoffView> = {}): InvoiceHandoffView {
  return {
    id: 'ih-1',
    version: 1,
    erveDispatch: { id: 'ed-1', erveDispatchNumber: 'EID/26-27/0001', dispatchDate: '2026-04-01T00:00:00.000Z' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'OUTRIGHT',
    saleOrderLineId: 'sol-1',
    style: { id: 'style-1', styleNumber: 'ST-1', styleName: 'Shirt', primaryImage: null },
    size: { sizeCode: 'M', sizeLabel: 'Medium' },
    quantity: 10,
    status: 'PENDING_TALLY',
    tallyInvoiceNumber: null,
    tallyInvoiceDate: null,
    tallyVoucherReference: null,
    remarks: null,
    recordedBy: null,
    recordedAt: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('prepareInvoiceHandoffDetailPdfData', () => {
  it("resolves the Style's primary image at the detail-image dimension", async () => {
    const handoff = makeHandoff({
      style: {
        id: 'style-1',
        styleNumber: 'ST-1',
        styleName: 'Shirt',
        primaryImage: {
          id: 'img-1',
          styleId: 'style-1',
          fileId: 'file-1',
          fileName: 'x',
          mimeType: 'image/jpeg',
          sizeBytes: 1,
          isPrimary: true,
          sortOrder: 0,
          createdAt: '',
          updatedAt: '',
        },
      },
    });
    resolveImagesForPdfMock.mockResolvedValue(new Map([['file-1', { dataUri: 'data:image/jpeg;base64,mock' }]]));

    const result = await prepareInvoiceHandoffDetailPdfData(handoff);

    expect(resolveImagesForPdfMock).toHaveBeenCalledWith(
      [{ id: 'file-1', path: '/styles/style-1/images/img-1/content' }],
      { maxDimension: 480 },
    );
    expect(result.primaryImage).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('returns a placeholder and skips the network call when the Style has no image', async () => {
    const result = await prepareInvoiceHandoffDetailPdfData(makeHandoff());
    expect(resolveImagesForPdfMock).not.toHaveBeenCalled();
    expect(result.primaryImage).toEqual({ placeholder: true });
  });
});
