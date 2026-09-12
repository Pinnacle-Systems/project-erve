import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { Factory } from '../types.js';

export interface FactoryDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface FactoryDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  usageItems: PdfKeyValueItem[];
}

/** Pure, synchronous, no HTTP — maps the already-loaded Factory record + meta into the Factory Detail PDF's view model. */
export function buildFactoryDetailViewModel(
  factory: Factory,
  meta: FactoryDetailPdfMeta,
): FactoryDetailPdfViewModel {
  const usage = factory.usage ?? { styleMappings: 0, jobOrders: 0, mappedUsers: 0 };
  return {
    title: 'FACTORY MASTER',
    subtitle: `${factory.code} — ${factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems: [
      { label: 'Code', value: factory.code },
      { label: 'Name', value: factory.name },
      { label: 'Status', value: factory.status },
      { label: 'Contact Name', value: factory.contactName },
      { label: 'Contact Email', value: factory.contactEmail },
      { label: 'Contact Phone', value: factory.contactPhone },
      { label: 'Address Line 1', value: factory.addressLine1 },
      { label: 'Address Line 2', value: factory.addressLine2 },
      { label: 'City', value: factory.city },
      { label: 'State', value: factory.state },
      { label: 'Country', value: factory.country },
      { label: 'Postal Code', value: factory.postalCode },
    ],
    usageItems: [
      { label: 'Style mappings', value: usage.styleMappings },
      { label: 'Job orders', value: usage.jobOrders },
      { label: 'Mapped users', value: usage.mappedUsers },
    ],
  };
}
