import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { Size } from '../types.js';

export interface SizeDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface SizeDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  usageItems: PdfKeyValueItem[];
}

/** Pure, synchronous, no HTTP — maps the already-loaded Size record + meta into the Size Detail PDF's view model. */
export function buildSizeDetailViewModel(size: Size, meta: SizeDetailPdfMeta): SizeDetailPdfViewModel {
  const usage = size.usage ?? { styleMappings: 0, purchaseOrderLines: 0, jobOrderLines: 0 };
  return {
    title: 'SIZE MASTER',
    subtitle: `${size.code} — ${size.label}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems: [
      { label: 'Code', value: size.code },
      { label: 'Label', value: size.label },
      { label: 'Type', value: size.sizeType.replace('_', ' ') },
      { label: 'Sort Order', value: size.sortOrder },
      { label: 'Status', value: size.status },
    ],
    usageItems: [
      { label: 'Style mappings', value: usage.styleMappings },
      { label: 'Order Sheet lines', value: usage.purchaseOrderLines },
      { label: 'Job-order lines', value: usage.jobOrderLines },
    ],
  };
}
