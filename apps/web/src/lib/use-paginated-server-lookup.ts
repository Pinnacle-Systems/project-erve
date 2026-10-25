import { useInfiniteQuery } from '@tanstack/react-query';
import { useDebouncedValue } from './use-debounced-value.js';
import { LOOKUP_DEBOUNCE_MS } from './use-server-lookup.js';

interface LookupPage<T> {
  items: T[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export function usePaginatedServerLookup<T>({
  queryKey,
  searchText,
  enabled,
  fetchPage,
  getKey,
}: {
  queryKey: readonly unknown[];
  searchText: string;
  enabled: boolean;
  fetchPage: (
    search: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<LookupPage<T>>;
  getKey: (item: T) => string;
}) {
  const trimmed = searchText.trim();
  const search = useDebouncedValue(trimmed, LOOKUP_DEBOUNCE_MS);
  const debouncing = search !== trimmed;
  const query = useInfiniteQuery({
    queryKey: [...queryKey, search],
    enabled: enabled && !debouncing,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage(search, pageParam, signal),
    getNextPageParam: (page) =>
      page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined,
    staleTime: 0,
    retry: false,
  });
  // No keepPreviousData: neither prior Factory nor prior text is selectable.
  const items = new Map<string, T>();
  if (enabled && !debouncing)
    for (const page of query.data?.pages ?? [])
      for (const item of page.items) items.set(getKey(item), item);
  return {
    ...query,
    options: [...items.values()],
    loading: enabled && (debouncing || query.isPending),
  };
}
