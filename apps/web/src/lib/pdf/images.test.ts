import type { AxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api-client.js';
import { resolveImagesForPdf, runWithConcurrency } from './images.js';
import { resizeImageBlobToDataUri } from './resizeImage.js';

vi.mock('./resizeImage.js', () => ({
  resizeImageBlobToDataUri: vi.fn(async () => 'data:image/jpeg;base64,mock'),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runWithConcurrency', () => {
  it('never runs more than `limit` tasks at once and completes all items', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let peak = 0;
    const seen: number[] = [];

    await runWithConcurrency(items, 4, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(item);
      active -= 1;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });
});

describe('resolveImagesForPdf', () => {
  it('resolves each ref to a data URI and respects bounded concurrency for the underlying fetches', async () => {
    let active = 0;
    let peak = 0;
    vi.spyOn(apiClient, 'get').mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { data: new Blob(['bytes']) };
    });

    const refs = Array.from({ length: 12 }, (_, i) => ({ id: `file-${i}`, path: `/styles/x/images/${i}/content` }));
    const result = await resolveImagesForPdf(refs, { concurrency: 3 });

    expect(peak).toBeLessThanOrEqual(3);
    expect(result.size).toBe(12);
    for (const ref of refs) {
      expect(result.get(ref.id)).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
    }
  });

  it('degrades a failed fetch to a placeholder instead of throwing', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network error'));

    const result = await resolveImagesForPdf([{ id: 'file-1', path: '/styles/x/images/1/content' }]);

    expect(result.get('file-1')).toEqual({ placeholder: true });
  });

  it('degrades a timed-out fetch to a placeholder', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(
      (_url: string, config?: AxiosRequestConfig) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener?.('abort', () => reject(new Error('aborted')));
        }),
    );

    const result = await resolveImagesForPdf([{ id: 'file-1', path: '/styles/x/images/1/content' }], {
      timeoutMs: 10,
    });

    expect(result.get('file-1')).toEqual({ placeholder: true });
  });

  it('one failed image does not prevent the others from resolving', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
      if (path.includes('bad')) throw new Error('broken image');
      return { data: new Blob(['bytes']) };
    });

    const result = await resolveImagesForPdf([
      { id: 'good-1', path: '/styles/x/images/good-1/content' },
      { id: 'bad-1', path: '/styles/x/images/bad/content' },
      { id: 'good-2', path: '/styles/x/images/good-2/content' },
    ]);

    expect(result.get('good-1')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
    expect(result.get('bad-1')).toEqual({ placeholder: true });
    expect(result.get('good-2')).toEqual({ dataUri: 'data:image/jpeg;base64,mock' });
  });

  it('reuses the cache instead of re-fetching a repeated file id within one export', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['bytes']) });
    const cache = new Map();

    await resolveImagesForPdf([{ id: 'shared-file', path: '/a' }], { cache });
    await resolveImagesForPdf([{ id: 'shared-file', path: '/a' }], { cache });

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('dedupes repeated ids within a single call before fetching', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['bytes']) });

    await resolveImagesForPdf([
      { id: 'same', path: '/a' },
      { id: 'same', path: '/a' },
      { id: 'same', path: '/a' },
    ]);

    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('handles an empty ref list without touching the network', async () => {
    const getSpy = vi.spyOn(apiClient, 'get');
    const result = await resolveImagesForPdf([]);
    expect(getSpy).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });
});

// Sanity check that the mock above is actually wired to the module under test.
describe('mock wiring', () => {
  it('resizeImageBlobToDataUri is mocked', async () => {
    await expect(resizeImageBlobToDataUri(new Blob(), 100, 0.8)).resolves.toBe(
      'data:image/jpeg;base64,mock',
    );
  });
});
