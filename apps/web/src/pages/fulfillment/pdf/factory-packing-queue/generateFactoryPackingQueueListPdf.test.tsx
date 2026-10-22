import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FactoryDispatchSummary } from '../../types.js';

const prepareMock = vi.fn();
const prepareAwaitingMock = vi.fn();
const buildViewModelMock = vi.fn((..._args: unknown[]) => ({ viewModel: 'stub' }));
const renderPdfBlobMock = vi.fn(async (..._args: unknown[]) => new Blob(['stub-pdf']));

const workerBlob = new Blob(['worker-pdf'], { type: 'application/pdf' });
class QueueWorker {
  static instances: QueueWorker[] = [];
  static failure: 'constructor' | 'post' | 'runtime' | 'decode' | null = null;
  static response: unknown = { type: 'success', blob: workerBlob };
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_request: unknown) => {
    if (QueueWorker.failure === 'post') throw new Error('Input clone failed');
    queueMicrotask(() => {
      if (QueueWorker.failure === 'runtime')
        this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
      else if (QueueWorker.failure === 'decode') this.onmessageerror?.();
      else this.onmessage?.({ data: QueueWorker.response } as MessageEvent);
    });
  });
  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    if (QueueWorker.failure === 'constructor') throw new Error('Worker unavailable');
    QueueWorker.instances.push(this);
  }
}

beforeEach(() => {
  QueueWorker.instances = [];
  QueueWorker.failure = null;
  QueueWorker.response = { type: 'success', blob: workerBlob };
  vi.stubGlobal('Worker', QueueWorker);
});

vi.mock('./prepareFactoryPackingQueueListPdfData.js', () => ({
  prepareFactoryPackingQueueListPdfData: (...args: unknown[]) => prepareMock(...args),
  prepareFactoryPackingQueueAwaitingData: (...args: unknown[]) => prepareAwaitingMock(...args),
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
  prepareAwaitingMock.mockReset();
  buildViewModelMock.mockClear();
  renderPdfBlobMock.mockClear();
  vi.unstubAllGlobals();
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
  it('renders the authorized complete view model in one module worker and terminates it', async () => {
    prepareMock.mockResolvedValue([]);
    prepareAwaitingMock.mockResolvedValue([]);
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');
    const result = await generateFactoryPackingQueueListPdfBlob({
      generatedAt: '2026-10-22T00:00:00Z',
    });
    expect(QueueWorker.instances).toHaveLength(1);
    const worker = QueueWorker.instances[0]!;
    expect(worker.url.pathname).toMatch(/factoryPackingQueueList\.worker\.ts$/);
    expect(worker.options).toEqual({ type: 'module' });
    expect(worker.postMessage).toHaveBeenCalledWith({ viewModel: { viewModel: 'stub' } });
    expect(result).toBe(workerBlob);
    expect(renderPdfBlobMock).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  });

  it.each(['constructor', 'post', 'runtime', 'decode'] as const)(
    'rejects a %s failure without rendering on the UI thread',
    async (failure) => {
      prepareMock.mockResolvedValue([]);
      QueueWorker.failure = failure;
      const { generateFactoryPackingQueueListPdfBlob } =
        await import('./generateFactoryPackingQueueListPdf.js');
      await expect(
        generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-10-22T00:00:00Z' }),
      ).rejects.toThrow();
      expect(renderPdfBlobMock).not.toHaveBeenCalled();
      for (const worker of QueueWorker.instances) expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    null,
    {},
    { type: 'success', blob: new Blob([]) },
    { type: 'success', blob: 'invalid' },
  ])('rejects an invalid worker result and cleans up: %j', async (response) => {
    prepareMock.mockResolvedValue([]);
    QueueWorker.response = response;
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');
    await expect(
      generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-10-22T00:00:00Z' }),
    ).rejects.toThrow();
    expect(QueueWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });

  it('propagates a render rejection and allows a fresh worker on retry', async () => {
    prepareMock.mockResolvedValue([]);
    QueueWorker.response = { type: 'error', message: 'Synthetic queue render failure' };
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');
    await expect(
      generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-10-22T00:00:00Z' }),
    ).rejects.toThrow('Synthetic queue render failure');
    QueueWorker.response = { type: 'success', blob: workerBlob };
    await expect(
      generateFactoryPackingQueueListPdfBlob([], { generatedAt: '2026-10-22T00:00:00Z' }),
    ).resolves.toBe(workerBlob);
    expect(QueueWorker.instances).toHaveLength(2);
    for (const worker of QueueWorker.instances) expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not start a worker or return partial data when an authorized fetch fails', async () => {
    prepareMock.mockRejectedValue(new Error('Dispatch pages failed'));
    prepareAwaitingMock.mockResolvedValue([]);
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');
    await expect(
      generateFactoryPackingQueueListPdfBlob({
        generatedAt: '2026-10-22T00:00:00Z',
        factoryId: 'factory-B',
      }),
    ).rejects.toThrow('Dispatch pages failed');
    expect(QueueWorker.instances).toHaveLength(0);
  });

  it('forwards meta.factoryId into prepareFactoryPackingQueueListPdfData', async () => {
    prepareMock.mockResolvedValue([dispatch()]);
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');

    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      generatedBy: 'Test User',
      factoryId: 'factory-B',
    });

    expect(prepareMock).toHaveBeenCalledWith('factory-B');
  });

  it('passes undefined through for a FACTORY_USER (no on-screen selection, server-scoped)', async () => {
    prepareMock.mockResolvedValue([]);
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');

    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      generatedBy: 'Factory User',
    });

    expect(prepareMock).toHaveBeenCalledWith(undefined);
  });

  it('switching the selected Factory between two exports changes the argument passed to preparation', async () => {
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');

    prepareMock.mockResolvedValueOnce([dispatch()]);
    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      factoryId: 'factory-A',
    });
    expect(prepareMock).toHaveBeenNthCalledWith(1, 'factory-A');

    prepareMock.mockResolvedValueOnce([dispatch()]);
    await generateFactoryPackingQueueListPdfBlob([], {
      generatedAt: '2026-09-01T00:00:00.000Z',
      factoryId: 'factory-B',
    });
    expect(prepareMock).toHaveBeenNthCalledWith(2, 'factory-B');
  });

  it('fetches both awaiting packing and dispatches across all pages when called with meta only', async () => {
    const { generateFactoryPackingQueueListPdfBlob } =
      await import('./generateFactoryPackingQueueListPdf.js');

    const d = dispatch();
    const qLine = {
      saleOrderId: 'so-1',
      saleOrderNumber: 'EISO/26-27/0001',
      distributor: { id: 'd1', code: 'D1', name: 'Distributor One' },
      saleOrderLineId: 'line-1',
      styleId: 'st-1',
      styleNumber: 'ST-001',
      styleName: 'Style 1',
      sizeId: 'sz-1',
      sizeCode: 'M',
      sizeLabel: 'Medium',
      allocatedQuantity: 10,
      packedQuantity: 2,
      remainingQuantity: 8,
    };

    prepareMock.mockResolvedValueOnce([d]);
    prepareAwaitingMock.mockResolvedValueOnce([qLine]);

    await generateFactoryPackingQueueListPdfBlob({
      generatedAt: '2026-09-01T00:00:00.000Z',
      generatedBy: 'Planner',
      factoryId: 'factory-A',
    });

    expect(prepareMock).toHaveBeenCalledWith('factory-A');
    expect(prepareAwaitingMock).toHaveBeenCalledWith('factory-A');
    expect(buildViewModelMock).toHaveBeenCalledWith(
      [qLine],
      [d],
      expect.objectContaining({ factoryId: 'factory-A' }),
    );
  });
});
