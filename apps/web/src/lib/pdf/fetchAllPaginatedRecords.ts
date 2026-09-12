import type { PaginatedResponse } from '@erve/types';

export interface FetchAllPaginatedRecordsOptions {
  /** Page size requested per call (the server clamps to its own max, e.g. 100 for job-orders/purchase-orders). */
  pageSize?: number;
  signal?: AbortSignal;
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * Exhausts a cursor-paginated endpoint sharing the `{ items, pageInfo: { limit, hasMore, nextCursor } }`
 * contract (GET /purchase-orders, GET /job-orders, and any future endpoint with the same shape),
 * fetching every page with identical filters/sort and preserving server order. `fetchPage` must be a
 * pure request function (typically a small closure around `apiClient.get`) so this helper never
 * touches React Query's cache or the caller's own component state, and never advances the user's
 * current UI page.
 *
 * A PDF list export needs every authorized record matching the current filters, not merely the
 * first page the screen happens to display — see prepareOrderSheetListPdfData / prepareJobOrderListPdfData.
 * If any page request rejects, this rejects immediately with no partial result: callers must not
 * catch this into a partial document. The same applies to a malformed pagination response
 * (`hasMore: true` with no usable `nextCursor`, or a `nextCursor` that repeats the previous one) —
 * this throws rather than silently truncating the export or looping forever.
 */
export async function fetchAllPaginatedRecords<T>(
  fetchPage: (params: { cursor?: string; limit: number }, signal?: AbortSignal) => Promise<PaginatedResponse<T>>,
  options: FetchAllPaginatedRecordsOptions = {},
): Promise<T[]> {
  const limit = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const results: T[] = [];
  let cursor: string | undefined;

  for (;;) {
    const page = await fetchPage({ cursor, limit }, options.signal);
    results.push(...page.items);
    if (!page.pageInfo.hasMore) break;

    const nextCursor = page.pageInfo.nextCursor;
    if (!nextCursor) {
      throw new Error(
        'Paginated export received hasMore=true with no nextCursor — cannot reliably fetch the remaining pages.',
      );
    }
    if (nextCursor === cursor) {
      throw new Error(
        'Paginated export received the same cursor twice in a row — aborting instead of looping forever.',
      );
    }
    cursor = nextCursor;
  }

  return results;
}
