import type { Size } from '../types.js';

export interface SizeListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface SizeListPdfRow {
  id: string;
  code: string;
  label: string;
  sizeType: string;
  sortOrder: number;
  status: string;
}

export interface SizeListPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: SizeListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: Size has no images and no async preparation step, so there is no
 * separate `prepare` module — this maps the already-loaded list query data + meta state directly
 * into the plain view-model SizeListDocument renders. Row order is preserved as returned by the
 * API (its fixed default order). The Size list screen currently has no search/status/sort
 * controls, so there is no filter state to represent here — unlike Style/Season/Distributor/User.
 */
export function buildSizeListViewModel(
  sizes: Size[],
  meta: SizeListPdfMeta,
): SizeListPdfViewModel {
  const rows: SizeListPdfRow[] = sizes.map((size) => ({
    id: size.id,
    code: size.code,
    label: size.label,
    sizeType: size.sizeType.replace('_', ' '),
    sortOrder: size.sortOrder,
    status: size.status,
  }));

  return {
    title: 'SIZE MASTER LIST',
    subtitle: 'Size codes available for style mapping',
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    totalCount: rows.length,
    rows,
  };
}
