import type { DistributorSummary } from '../types.js';

export interface DistributorListPdfFilters {
  search?: string;
  status?: string;
}

export interface DistributorListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface DistributorListPdfRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  city: string | null;
  status: string;
}

export interface DistributorListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: DistributorListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps the already-loaded list query data + filter/meta state into
 * the plain view-model DistributorListDocument renders. The list endpoint's `select` currently
 * omits GSTIN and Purchase Mode (only the Distributor Detail endpoint returns them) — those two
 * commercially-important fields appear on the Detail PDF instead; inventing them here would mean
 * fabricating data the list screen was never given. Row order is preserved as returned by the API
 * (its fixed default order); Distributor has no user-facing sort control today.
 */
export function buildDistributorListViewModel(
  distributors: DistributorSummary[],
  filters: DistributorListPdfFilters,
  meta: DistributorListPdfMeta,
): DistributorListPdfViewModel {
  const rows: DistributorListPdfRow[] = distributors.map((distributor) => ({
    id: distributor.id,
    code: distributor.code,
    name: distributor.name,
    contactName: distributor.contactName,
    city: distributor.city,
    status: distributor.status,
  }));

  return {
    title: 'DISTRIBUTOR MASTER LIST',
    subtitle: 'Distributor master records and contacts',
    filters: [
      { label: 'Search', value: filters.search ?? '' },
      { label: 'Status', value: filters.status ?? '' },
    ],
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
