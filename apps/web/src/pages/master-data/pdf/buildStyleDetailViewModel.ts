import type { PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PreparedStyleDetailPdfData } from './prepareStyleDetailPdfData.js';

export interface StyleDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface StyleDetailFactoryRow {
  id: string;
  name: string;
  exFactoryPrice: string;
}

export interface StyleDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  image: PdfImageSource;
  identityItems: PdfKeyValueItem[];
  seasonLabel: string;
  sizeLabels: string[];
  factoryRows: StyleDetailFactoryRow[];
}

/** Pure, synchronous, no HTTP — maps already-resolved data + meta into the Style Detail PDF's view model. */
export function buildStyleDetailViewModel(
  prepared: PreparedStyleDetailPdfData,
  meta: StyleDetailPdfMeta,
): StyleDetailPdfViewModel {
  const { style } = prepared;
  return {
    title: 'STYLE MASTER',
    subtitle: `${style.styleNumber} — ${style.styleName}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    image: prepared.primaryImage,
    identityItems: [
      { label: 'Style Number', value: style.styleNumber },
      { label: 'Style Name', value: style.styleName },
      { label: 'Status', value: style.status },
      { label: 'Description', value: style.description },
      { label: 'Category', value: style.categoryDescription },
      { label: 'Item Name Group', value: style.itemNameGroup },
      { label: 'IP Name', value: style.ipName },
      { label: 'Licensor', value: style.licensor },
      { label: 'Colour', value: style.colour },
      { label: 'LMIX Number', value: style.lmixNumber },
      { label: 'HSN Code', value: style.hsnCode },
      { label: 'HSN Description', value: style.hsnDescription },
      { label: 'Final MRP', value: style.finalMrp.toFixed(2) },
      { label: 'Royalty %', value: style.royaltyPercentage ?? undefined },
    ],
    seasonLabel: `${style.season.displayName} — ${style.season.name}`,
    sizeLabels: style.sizes.map((size) => size.code),
    factoryRows: style.factories.map((factory) => ({
      id: factory.id,
      name: factory.name,
      exFactoryPrice: factory.exFactoryPrice.toFixed(2),
    })),
  };
}
