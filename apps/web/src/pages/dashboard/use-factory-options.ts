import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import type { JobOrderFactoryOption } from '../job-orders/types.js';

// Reuses the same /job-orders/factory-options lookup the Job Order list's
// Factory filter already uses (UXAUTH-014) — same audience
// (JOB_ORDER_FACTORY_FILTER_ROLES already covers ADMIN/MERCHANDISER/
// SENIOR_MANAGEMENT/QA_USER), so the Dashboard's Factory filter never
// diverges from it.
export function useFactoryOptionsQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['job-order-factory-options'],
    enabled,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrderFactoryOption[]>>(
        '/job-orders/factory-options',
      );
      return res.data.data;
    },
  });
}
