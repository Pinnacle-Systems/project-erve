import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateErvePackingListDetailPdfBlob } from './generateErvePackingListDetailPdf.js';
import { packingListFixture } from './ervePackingListPdf.test-utils.js';

class TestWorker {
  static instances: TestWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(() => {
    if (TestWorker.failPost) throw new Error('Clone failed');
  });
  terminate = vi.fn();
  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    TestWorker.instances.push(this);
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  TestWorker.instances = [];
  TestWorker.failPost = false;
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => vi.unstubAllGlobals());
const source = packingListFixture(1, 1, 1);
const meta = { generatedAt: '2026-10-21T00:00:00Z', generatedBy: 'Worker test' };

it('runs the complete generation in a dedicated module worker and returns its final Blob', async () => {
  const result = generateErvePackingListDetailPdfBlob(source, meta);
  if (TestWorker.instances.length === 0) {
    await result;
    expect(TestWorker.instances).toHaveLength(1);
    return;
  }
  const worker = TestWorker.instances[0]!;
  expect(worker.url.pathname).toMatch(/ervePackingListDetail\.worker\.ts$/);
  expect(worker.options).toEqual({ type: 'module' });
  expect(worker.postMessage).toHaveBeenCalledWith({ packingList: source, meta });
  const blob = new Blob(['complete PDF'], { type: 'application/pdf' });
  worker.reply({ type: 'success', blob });
  expect(await result).toBe(blob);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
});

it('rejects a worker render failure and terminates before allowing another generation', async () => {
  const result = generateErvePackingListDetailPdfBlob(source, meta);
  const worker = TestWorker.instances[0]!;
  worker.reply({ type: 'error', message: 'Synthetic batch failure' });
  await expect(result).rejects.toThrow('Synthetic batch failure');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  const retry = generateErvePackingListDetailPdfBlob(source, meta);
  TestWorker.instances[1]!.reply({
    type: 'success',
    blob: new Blob(['retry'], { type: 'application/pdf' }),
  });
  expect((await retry).size).toBe(5);
  expect(TestWorker.instances[1]!.terminate).toHaveBeenCalledTimes(1);
});

it('rejects worker startup/runtime errors and cleans up', async () => {
  const result = generateErvePackingListDetailPdfBlob(source, meta);
  const worker = TestWorker.instances[0]!;
  worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
  await expect(result).rejects.toThrow('Packing list PDF worker failed');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it('rejects message decoding errors and cleans up', async () => {
  const result = generateErvePackingListDetailPdfBlob(source, meta);
  const worker = TestWorker.instances[0]!;
  worker.onmessageerror?.();
  await expect(result).rejects.toThrow('Packing list PDF worker response');
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});

it.each([
  null,
  {},
  { type: 'success', blob: new Blob([]) },
  { type: 'success', blob: 'not a Blob' },
])(
  'rejects malformed or empty PDF responses rather than returning incomplete content: %j',
  async (reply) => {
    const result = generateErvePackingListDetailPdfBlob(source, meta);
    TestWorker.instances[0]!.reply(reply);
    await expect(result).rejects.toThrow('Packing list PDF worker response');
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  },
);

it('cleans up when posting source data fails', async () => {
  TestWorker.failPost = true;
  await expect(generateErvePackingListDetailPdfBlob(source, meta)).rejects.toThrow('Clone failed');
  expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
});

it('rejects worker construction failure without starting a main-thread fallback', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('Worker blocked');
      }
    },
  );
  await expect(generateErvePackingListDetailPdfBlob(source, meta)).rejects.toThrow(
    'Worker blocked',
  );
});
