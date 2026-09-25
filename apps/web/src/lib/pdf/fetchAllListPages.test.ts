import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAllListPages } from './fetchAllListPages.js';

const getMock = vi.fn();
vi.mock('../api-client.js', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

afterEach(() => getMock.mockReset());

const page = (items: string[], nextCursor: string | null) => ({
  data: { data: { items, pageInfo: { limit: 100, hasMore: nextCursor !== null, nextCursor } } },
});

describe('fetchAllListPages', () => {
  it('fetches every page with the same filters, in server order', async () => {
    getMock.mockResolvedValueOnce(page(['a', 'b'], 'b')).mockResolvedValueOnce(page(['c'], null));

    const rows = await fetchAllListPages<string>('/styles', { search: 'tee', status: 'ACTIVE' });

    expect(rows).toEqual(['a', 'b', 'c']);
    expect(getMock).toHaveBeenNthCalledWith(1, '/styles', {
      params: { search: 'tee', status: 'ACTIVE', cursor: undefined, limit: 100 },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/styles', {
      params: { search: 'tee', status: 'ACTIVE', cursor: 'b', limit: 100 },
    });
  });

  it('rejects rather than returning a partial export when a later page fails', async () => {
    getMock.mockResolvedValueOnce(page(['a'], 'a')).mockRejectedValueOnce(new Error('network'));

    await expect(fetchAllListPages('/styles')).rejects.toThrow('network');
  });
});
