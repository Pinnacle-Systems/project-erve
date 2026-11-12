import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, DistributorOption } from '@erve/types';
import { useAuth } from '../../../auth/AuthContext.js';
import { canPickRetailStoreInventoryDistributor } from '../../../auth/permissions.js';
import { apiClient } from '../../../lib/api-client.js';

export type StockDistributorFilterState = 'none' | 'loading' | 'ready' | 'invalid' | 'error';

/**
 * The optional Distributor filter of the consolidated Sale-or-Return Stock screens.
 *
 * Only internal roles that can use the Distributor lookup get it (ADMIN, MERCHANDISER,
 * SENIOR_MANAGEMENT). A DISTRIBUTOR never sees a selector and never sends a distributorId - the API
 * pins it to its own Distributor regardless. ACCOUNTANT reads every Distributor consolidated and
 * has no lookup access, so it has no filter either.
 *
 * The selection lives in the URL (`?distributorId=`) so it survives a refresh and is shareable. A
 * URL id is only trusted once it resolves to a real Distributor (`/distributors/options/:id`); a
 * stale or hand-edited id is never sent to the stock endpoints and is never treated as "no filter".
 * Unlike the transactional per-Dispatch screen, an inactive Distributor is fine here: it may still
 * hold stock and this view is read-only.
 */
export function useStockDistributorFilter() {
  const { user } = useAuth();
  const canPick = canPickRetailStoreInventoryDistributor(user);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawId = canPick ? searchParams.get('distributorId') : null;

  const optionQuery = useQuery({
    queryKey: ['distributor-option', rawId],
    enabled: Boolean(rawId),
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiSuccessResponse<DistributorOption>>(
          `/distributors/options/${encodeURIComponent(rawId!)}`,
        );
        return res.data.data;
      } catch (caught) {
        if (isAxiosError(caught) && caught.response?.status === 404) return null;
        throw caught;
      }
    },
  });

  const distributor = rawId ? (optionQuery.data ?? null) : null;
  let state: StockDistributorFilterState = 'none';
  if (rawId) {
    if (optionQuery.isLoading) state = 'loading';
    else if (optionQuery.isError) state = 'error';
    else state = distributor ? 'ready' : 'invalid';
  }

  const setDistributor = useCallback(
    (next: Pick<DistributorOption, 'id' | 'name'> | null) => {
      const params = new URLSearchParams(searchParams);
      if (next) {
        if ('code' in next) queryClient.setQueryData(['distributor-option', next.id], next);
        params.set('distributorId', next.id);
      } else {
        params.delete('distributorId');
      }
      setSearchParams(params, { replace: true });
    },
    [queryClient, searchParams, setSearchParams],
  );

  return {
    canPick,
    state,
    distributor,
    /** The id to send to the API: only a confirmed, resolved Distributor; otherwise undefined (all). */
    distributorId: state === 'ready' ? distributor!.id : undefined,
    /** False while an unresolved/invalid id is in the URL: no stock request may be issued yet. */
    queryAllowed: state === 'none' || state === 'ready',
    setDistributor,
  };
}
