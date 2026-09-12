import { describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '@erve/types';
import { fetchAllPaginatedRecords } from './fetchAllPaginatedRecords.js';

function page<T>(items: T[], pageInfo: PaginatedResponse<T>['pageInfo']): PaginatedResponse<T> {
  return { items, pageInfo };
}

describe('fetchAllPaginatedRecords', () => {
  it('returns all items from a single-page response', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      page(['a', 'b'], { limit: 100, hasMore: false, nextCursor: null }),
    );

    const result = await fetchAllPaginatedRecords(fetchPage);

    expect(result).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array for a zero-result response without looping', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([], { limit: 100, hasMore: false, nextCursor: null }));

    const result = await fetchAllPaginatedRecords(fetchPage);

    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('fetches every remaining page and preserves server order when flattening', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a', 'b'], { limit: 2, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(page(['c', 'd'], { limit: 2, hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(page(['e'], { limit: 2, hasMore: false, nextCursor: null }));

    const result = await fetchAllPaginatedRecords(fetchPage, { pageSize: 2 });

    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('passes an identical limit and the previous page nextCursor on every call', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { limit: 50, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(page(['b'], { limit: 50, hasMore: false, nextCursor: null }));

    await fetchAllPaginatedRecords(fetchPage, { pageSize: 50 });

    expect(fetchPage).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: 50 }, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: 'cursor-1', limit: 50 }, undefined);
  });

  it('defaults the page size to 100 when none is given', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page([], { limit: 100, hasMore: false, nextCursor: null }));

    await fetchAllPaginatedRecords(fetchPage);

    expect(fetchPage).toHaveBeenCalledWith({ cursor: undefined, limit: 100 }, undefined);
  });

  it('forwards an AbortSignal to every page request', async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn().mockResolvedValue(page([], { limit: 100, hasMore: false, nextCursor: null }));

    await fetchAllPaginatedRecords(fetchPage, { signal: controller.signal });

    expect(fetchPage).toHaveBeenCalledWith({ cursor: undefined, limit: 100 }, controller.signal);
  });

  it('fails the whole export with no partial result when a later page rejects', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { limit: 1, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(page(['b'], { limit: 1, hasMore: true, nextCursor: 'cursor-2' }))
      .mockRejectedValueOnce(new Error('network error on page 3'));

    await expect(fetchAllPaginatedRecords(fetchPage, { pageSize: 1 })).rejects.toThrow(
      'network error on page 3',
    );
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('throws instead of silently truncating when hasMore is true but nextCursor is missing', async () => {
    const fetchPage = vi.fn().mockResolvedValue(page(['a'], { limit: 1, hasMore: true, nextCursor: null }));

    await expect(fetchAllPaginatedRecords(fetchPage, { pageSize: 1 })).rejects.toThrow(
      /hasMore=true with no nextCursor/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('throws instead of looping forever when nextCursor repeats the previous cursor', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page(['a'], { limit: 1, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValue(page(['a'], { limit: 1, hasMore: true, nextCursor: 'cursor-1' }));

    await expect(fetchAllPaginatedRecords(fetchPage, { pageSize: 1 })).rejects.toThrow(
      /same cursor twice in a row/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
