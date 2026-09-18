import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FactoryDispatchSummary } from '../../types.js';

const prepareMock = vi.fn();
const buildViewModelMock = vi.fn((..._args: unknown[]) => ({ viewModel: 'stub' }));
const renderPdfBlobMock = vi.fn(async (..._args: unknown[]) => new Blob(['stub-pdf']));

vi.mock('./prepareFactoryPackingQueueListPdfData.js', () => ({
  prepareFactoryPackingQueueListPdfData: (...args: unknown[]) => prepareMock(...args),
}));
vi.mock('./buildFactoryPackingQueueListViewModel.js', () => ({
  buildFactoryPackingQueueListViewModel: (...args: unknown[]) => buildViewModelMock(...args),
}));
vi.mock('./FactoryPackingQueueListDocument.js', () => ({
  FactoryPackingQueueListDocument: () => null,
}));
vi.mock('../../../../lib/pdf/generate.js', () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlobMock(...args),
}));

afterEach(() => {
  prepareMock.mockReset();
  buildViewModelMock.mockClear();
  renderPdfBlobMock.mockClear();
});

function dispatch(): FactoryDispatchSummary {
  return {
    id: 'fd-1',
    factoryDispatchNumber: 'EIFD/26-27/0001',
    factory: { id: 'f1', code: 'F1', name: 'Factory One' },
    saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001', distributors: [] },
    status: 'DRAFT',
    version: 1,
    preparedAt: '2026-09-01T00:00:00.000Z',
    finalizedAt: null,
    consolidated: false,
  };
}

// UXAUTH-005: the on-screen Factory selection (meta.factoryId) must reach
// the "Your Factory Dispatches" re-fetch — this was the un-scoped export
// defect. Proven here without exercising real @react-pdf/renderer output.
describe('generateFactoryPackingQueueListPdfBlob', () => {
  it('forwards meta.factoryId into prepareFactoryPackingQueueListPdfData', async () => {
    prepareMock.mockResolvedValue([dispatch()]);
    const { generateFactoryPackingQueueListPdfBlob } = await import('./generateFactoryPackingQueueListPdf.js');

    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      generatedBy: 'Test User',
      factoryId: 'factory-B',
    });

    expect(prepareMock).toHaveBeenCalledWith('factory-B');
  });

  it('passes undefined through for a FACTORY_USER (no on-screen selection, server-scoped)', async () => {
    prepareMock.mockResolvedValue([]);
    const { generateFactoryPackingQueueListPdfBlob } = await import('./generateFactoryPackingQueueListPdf.js');

    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      generatedBy: 'Factory User',
    });

    expect(prepareMock).toHaveBeenCalledWith(undefined);
  });

  it('switching the selected Factory between two exports changes the argument passed to preparation', async () => {
    const { generateFactoryPackingQueueListPdfBlob } = await import('./generateFactoryPackingQueueListPdf.js');

    prepareMock.mockResolvedValueOnce([dispatch()]);
    await generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-09-01T00:00:00.000Z', factoryId: 'factory-A' });
    expect(prepareMock).toHaveBeenNthCalledWith(1, 'factory-A');

    prepareMock.mockResolvedValueOnce([dispatch()]);
    await generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-09-01T00:00:00.000Z', factoryId: 'factory-B' });
    expect(prepareMock).toHaveBeenNthCalledWith(2, 'factory-B');
  });
});
