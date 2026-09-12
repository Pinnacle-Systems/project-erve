import { toCompactFinancialYearCode } from '../../../lib/financial-years.js';
import type { Season } from '../types.js';

export interface SeasonListPdfFilters {
  financialYear?: string;
}

export interface SeasonListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface SeasonListPdfRow {
  id: string;
  code: string;
  name: string;
  financialYearCode: string;
  displayName: string;
  status: string;
}

export interface SeasonListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: SeasonListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: Season has no images and no async preparation step, so there is no
 * separate `prepare` module here — this maps the already-loaded list query data + filter/meta
 * state directly into the plain view-model SeasonListDocument renders. Row order is preserved as
 * returned by the API (its fixed default order); Season has no user-facing sort control today.
 */
export function buildSeasonListViewModel(
  seasons: Season[],
  filters: SeasonListPdfFilters,
  meta: SeasonListPdfMeta,
): SeasonListPdfViewModel {
  const rows: SeasonListPdfRow[] = seasons.map((season) => ({
    id: season.id,
    code: season.code,
    name: season.name,
    financialYearCode: toCompactFinancialYearCode(season.financialYear.code),
    displayName: season.displayName,
    status: season.status,
  }));

  return {
    title: 'SEASON MASTER LIST',
    subtitle: 'Season master records',
    filters: [{ label: 'Financial Year', value: filters.financialYear ?? '' }],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
