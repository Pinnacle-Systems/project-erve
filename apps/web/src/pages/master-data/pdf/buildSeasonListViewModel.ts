import type { Season } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- kept for call-site symmetry with other list PDFs; Season has no PDF-scoped filters any more (ISS-SEASON-FY).
export interface SeasonListPdfFilters {}

export interface SeasonListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface SeasonListPdfRow {
  id: string;
  code: string;
  name: string;
  displayName: string;
  status: string;
}

export interface SeasonListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: SeasonListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: Season has no images and no async preparation step, so there is no
 * separate `prepare` module here — this maps the already-loaded list query data + meta state
 * directly into the plain view-model SeasonListDocument renders. Row order is preserved as
 * returned by the API (its fixed default order); Season has no user-facing sort control today.
 */
export function buildSeasonListViewModel(
  seasons: Season[],
  _filters: SeasonListPdfFilters,
  meta: SeasonListPdfMeta,
): SeasonListPdfViewModel {
  const rows: SeasonListPdfRow[] = seasons.map((season) => ({
    id: season.id,
    code: season.code,
    name: season.name,
    displayName: season.displayName,
    status: season.status,
  }));

  return {
    title: 'SEASON MASTER LIST',
    subtitle: 'Season master records',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
