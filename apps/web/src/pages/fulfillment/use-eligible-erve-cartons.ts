import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, EligibleErveCartonPage } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function useEligibleErveCartons(ervePackingListId?: string, enabled = true) {
  const [search, setSearch] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['erve-packing-lists', 'eligible-cartons', ervePackingListId ?? null, search],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const res = await apiClient.get<ApiSuccessResponse<EligibleErveCartonPage>>(
        '/erve-packing-lists/eligible-cartons',
        {
          params: { ervePackingListId, search, limit: 25, cursor: pageParam },
          signal,
        },
      );
      return res.data.data;
    },
    getNextPageParam: (page) =>
      page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined,
    retry: false,
  });
  const cartons = useMemo(
    () => [
      ...new Map(
        query.data?.pages.flatMap((page) => page.items).map((carton) => [carton.id, carton]),
      ).values(),
    ],
    [query.data],
  );
  const lastPageEmpty = query.data?.pages.at(-1)?.items.length === 0;
  return {
    query,
    cartons,
    search,
    setSearch: (value: string) => setSearch(value.trim().toLowerCase()),
    lastPageEmpty,
  };
}
