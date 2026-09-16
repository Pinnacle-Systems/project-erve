import type { ApiSuccessResponse, PaginatedResponse } from '@erve/types';
import { apiClient } from '../../../../lib/api-client.js';
import { fetchAllPaginatedRecords } from '../../../../lib/pdf/fetchAllPaginatedRecords.js';
import type { PackingAuditQueueItem } from '../../types.js';

const EXPORT_PAGE_SIZE = 100;

/**
 * The only network-touching step for the Packing Audit List PDF. GET /packing-audit/queue is
 * properly cursor-paginated (default limit 25, max 100), but the screen itself calls it with a
 * flat `limit: 100` and no cursor/"load more" — so any queue beyond 100 open cartons is silently
 * invisible on-screen today. A PDF export must not inherit that cap: this loops every page (no
 * extra filters — the screen exposes none) so the export always contains every open carton on an
 * active (not yet finalized) Factory Dispatch, matching the queue's own actual semantics.
 */
export async function preparePackingAuditListPdfData(): Promise<PackingAuditQueueItem[]> {
  return fetchAllPaginatedRecords(
    async ({ cursor, limit }) => {
      const res = await apiClient.get<ApiSuccessResponse<PaginatedResponse<PackingAuditQueueItem>>>('/packing-audit/queue', {
        params: { cursor, limit },
      });
      return res.data.data;
    },
    { pageSize: EXPORT_PAGE_SIZE },
  );
}
