import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackingListView } from '../../types.js';

const prepareImagesMock = vi.fn();
const buildViewModelMock = vi.fn((..._args: unknown[]) => ({ viewModel: 'stub' }));
const renderPdfBlobMock = vi.fn(async (..._args: unknown[]) => new Blob(['stub-pdf']));

vi.mock('./prepareFactoryPackingListPdfImages.js', () => ({
  prepareFactoryPackingListPdfImages: (...args: unknown[]) => prepareImagesMock(...args),
}));
vi.mock('./buildFactoryPackingListViewModel.js', () => ({
  buildFactoryPackingListViewModel: (...args: unknown[]) => buildViewModelMock(...args),
}));
vi.mock('./FactoryPackingListDetailDocument.js', () => ({
  FactoryPackingListDetailDocument: () => null,
}));
vi.mock('../../../../lib/pdf/generate.js', () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlobMock(...args),
}));

afterEach(() => {
  prepareImagesMock.mockReset();
  buildViewModelMock.mockClear();
  renderPdfBlobMock.mockClear();
});

function packingList(): PackingListView {
  return {
    saleOrderId: 'so-1',
    saleOrderNumber: 'EISO/26-27/0001',
    distributors: [{ id: 'dist-1', code: 'D1', name: 'Distributor One' }],
    factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
    factoryDispatch: null,
    destinations: [],
    retiredCartons: [],
  };
}

// ISS-039: the only new wiring this ticket adds — resolved Style images must reach the view-model
// builder, and a failure resolving images must never silently swallow/alter the rest of PDF
// generation (resolveImagesForPdf already degrades per-image failures to a placeholder, so this
// only has to prove the plumbing, not re-prove that lower-level degradation).
describe('generateFactoryPackingListPdfBlob', () => {
  it('resolves Style images first, then threads the resulting map into buildFactoryPackingListViewModel', async () => {
    const list = packingList();
    const styleImages = new Map([['style-1', { dataUri: 'data:image/png;base64,mock' }]]);
    prepareImagesMock.mockResolvedValue(styleImages);
    const { generateFactoryPackingListPdfBlob } = await import('./generateFactoryPackingListPdf.js');

    const result = await generateFactoryPackingListPdfBlob(list, { generatedAt: '2026-10-22T00:00:00Z' });

    expect(prepareImagesMock).toHaveBeenCalledWith(list);
    expect(buildViewModelMock).toHaveBeenCalledWith(list, { generatedAt: '2026-10-22T00:00:00Z' }, styleImages);
    expect(renderPdfBlobMock).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Blob);
  });

  it('propagates (never silently swallows) an unexpected image-resolution rejection rather than generating a PDF with unresolved imagery', async () => {
    prepareImagesMock.mockRejectedValue(new Error('Synthetic image-resolution failure'));
    const { generateFactoryPackingListPdfBlob } = await import('./generateFactoryPackingListPdf.js');

    await expect(
      generateFactoryPackingListPdfBlob(packingList(), { generatedAt: '2026-10-22T00:00:00Z' }),
    ).rejects.toThrow('Synthetic image-resolution failure');
    expect(buildViewModelMock).not.toHaveBeenCalled();
    expect(renderPdfBlobMock).not.toHaveBeenCalled();
  });
});
