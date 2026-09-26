import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export interface SeasonFilterOption {
  id: string;
  code: string;
  name: string;
  displayName?: string;
}

// RPT2 — a reports-scoped Season lookup (GET /reports/season-options),
// deliberately not GET /seasons/options: that endpoint is ADMIN/MERCHANDISER
// only, and SENIOR_MANAGEMENT is a full V1 reporting-audience role that
// still needs to filter the Dashboard by Season.
export function useSeasonOptionsQuery() {
  return useQuery({
    queryKey: ['reports', 'season-options'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SeasonFilterOption[]>>('/reports/season-options');
      return res.data.data;
    },
  });
}
