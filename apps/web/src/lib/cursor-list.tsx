import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { Button, ValidationMessage } from '@erve/primitives';
import { apiClient } from './api-client.js';

export interface CursorListOptions {
  // Query-key prefix; `params` is appended, so any filter/search change
  // starts again from the first page.
  queryKey: readonly unknown[];
  // A cursor-paginated endpoint: ?cursor=&limit= → { items, pageInfo }.
  path: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
}

// Every page of a cursor-paginated list, kept so "Load more" appends rather
// than replaces. The server applies search, filters and scoping before it
// pages; the client only follows pageInfo.nextCursor.
export function useCursorList<T>({ queryKey, path, params, enabled = true }: CursorListOptions) {
  const query = useInfiniteQuery({
    queryKey: [...queryKey, params],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<T>>>(path, {
        params: { ...params, cursor: pageParam },
      });
      return res.data.data;
    },
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasMore && lastPage.pageInfo.nextCursor
        ? lastPage.pageInfo.nextCursor
        : undefined,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);
  return { query, items };
}

export interface LoadMoreFooterProps {
  count: number;
  // Singular and plural row nouns, e.g. ['job order', 'job orders'].
  noun: readonly [string, string];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
}

// "Showing N rows (all loaded)" plus Load more while the server has more.
export function LoadMoreFooter({
  count,
  noun,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: LoadMoreFooterProps) {
  return (
    <>
      {count > 0 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Showing {count.toLocaleString()} {count === 1 ? noun[0] : noun[1]}
            {hasNextPage ? '' : ' (all loaded)'}
          </span>
          {hasNextPage ? (
            <Button variant="secondary" onClick={onLoadMore} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {isFetchNextPageError ? (
        <ValidationMessage tone="error">
          Unable to load more {noun[1]}. Try again.
        </ValidationMessage>
      ) : null}
    </>
  );
}

// Spread onto <LoadMoreFooter> from a useCursorList result.
export function loadMoreProps(
  query: ReturnType<typeof useCursorList>['query'],
  count: number,
  noun: readonly [string, string],
): LoadMoreFooterProps {
  return {
    count,
    noun,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    onLoadMore: () => void query.fetchNextPage(),
  };
}
