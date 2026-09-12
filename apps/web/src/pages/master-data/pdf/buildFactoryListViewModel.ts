import type { Factory } from '../types.js';

export interface FactoryListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryListPdfRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
}

export interface FactoryListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: FactoryListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: Factory has no images and no async preparation step, so there is no
 * separate `prepare` module — this maps the already-loaded list query data + meta state directly
 * into the plain view-model FactoryListDocument renders. Row order is preserved as returned by the
 * API (its fixed default order). The Factory list screen currently has no search/status/sort
 * controls, so there is no filter state to represent here.
 */
export function buildFactoryListViewModel(
  factories: Factory[],
  meta: FactoryListPdfMeta,
): FactoryListPdfViewModel {
  const rows: FactoryListPdfRow[] = factories.map((factory) => ({
    id: factory.id,
    code: factory.code,
    name: factory.name,
    contactName: factory.contactName,
    contactEmail: factory.contactEmail,
    contactPhone: factory.contactPhone,
    status: factory.status,
  }));

  return {
    title: 'FACTORY MASTER LIST',
    subtitle: 'Factory master records and contacts',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
