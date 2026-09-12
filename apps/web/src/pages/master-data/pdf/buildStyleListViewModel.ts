import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { PreparedStyleListPdfData } from './prepareStyleListPdfData.js';

export interface StyleListPdfFilters {
  search?: string;
  status?: string;
}

export interface StyleListPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface StyleListPdfRow {
  id: string;
  image: PdfImageSource;
  styleNumber: string;
  styleName: string;
  seasonLabel: string;
  hsnCode: string;
  status: string;
}

export interface StyleListPdfViewModel {
  title: string;
  subtitle: string;
  filters: Array<{ label: string; value: string }>;
  generatedAt: string;
  generatedBy?: string | null;
  totalCount: number;
  rows: StyleListPdfRow[];
}

/**
 * Pure, synchronous, no HTTP: maps already-resolved data + filter/meta state into the plain
 * view-model StyleListDocument renders. Style has no user-facing sort control today, so row
 * order is preserved as returned by the API (its fixed default order) — if a sort control is
 * added later, this and the PDF's sort metadata must be updated together.
 */
export function buildStyleListViewModel(
  prepared: PreparedStyleListPdfData,
  filters: StyleListPdfFilters,
  meta: StyleListPdfMeta,
): StyleListPdfViewModel {
  const rows: StyleListPdfRow[] = prepared.styles.map((style) => ({
    id: style.id,
    image: prepared.images.get(style.id) ?? { placeholder: true },
    styleNumber: style.styleNumber,
    styleName: style.styleName,
    seasonLabel: style.season.displayName,
    hsnCode: style.hsnCode ?? '',
    status: style.status,
  }));

  return {
    title: 'STYLE MASTER LIST',
    subtitle: 'Item master records',
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
