import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { Distributor } from '../types.js';

export interface DistributorDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface DistributorDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Distributor record + meta into the
 * Distributor Detail PDF's view model. Purchase Mode is authoritative and immutable after
 * creation on the Distributor Master (see the `Distributor` type) — it is represented here
 * exactly as the Detail screen shows it, not inferred or extended beyond the stored value.
 */
export function buildDistributorDetailViewModel(
  distributor: Distributor,
  meta: DistributorDetailPdfMeta,
): DistributorDetailPdfViewModel {
  return {
    title: 'DISTRIBUTOR MASTER',
    subtitle: `${distributor.code} — ${distributor.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems: [
      { label: 'Code', value: distributor.code },
      { label: 'Name', value: distributor.name },
      { label: 'Status', value: distributor.status },
      { label: 'GSTIN', value: distributor.gstin },
      {
        label: 'Purchase Mode',
        value: distributor.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale or Return',
      },
      { label: 'Contact Name', value: distributor.contactName },
      { label: 'Contact Email', value: distributor.contactEmail },
      { label: 'Contact Phone', value: distributor.contactPhone },
      { label: 'Address Line 1', value: distributor.addressLine1 },
      { label: 'Address Line 2', value: distributor.addressLine2 },
      { label: 'City', value: distributor.city },
      { label: 'State', value: distributor.state },
      { label: 'Country', value: distributor.country },
      { label: 'Postal Code', value: distributor.postalCode },
    ],
  };
}
