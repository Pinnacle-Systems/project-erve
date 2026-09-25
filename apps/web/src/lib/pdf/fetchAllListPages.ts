import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../api-client.js';
import { fetchAllPaginatedRecords } from './fetchAllPaginatedRecords.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * Every record a cursor-paginated list endpoint returns for `params` — the
 * list PDFs' data source once a list screen only holds the pages the user
 * has loaded. Same filters as the screen, server order preserved, and it
 * rejects (never truncates) on any failed or malformed page; see
 * fetchAllPaginatedRecords.
 */
export async function fetchAllListPages<T>(
  path: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<T>>>(path, {
        params: { ...params, cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
