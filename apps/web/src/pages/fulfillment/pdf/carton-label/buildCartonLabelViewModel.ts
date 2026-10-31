import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from '../../types.js';
import { distinctSizeColumns, groupLinesByStyle, type SizeColumn } from '../../style-size-grouping.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';

export interface CartonLabelSource {
  carton: FactoryPackingCartonView;
  destination: PackingListDestinationView;
  saleOrderNumber: string;
  factoryName: string;
  factoryDispatchNumber: string | null;
}

export interface CartonLabelPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

/** ISS-009: one Style per row, authoritative Sizes as columns. Images are pre-resolved before rendering. */
export interface CartonLabelStyleRow {
  styleId: string;
  styleNumber: string;
  styleName: string | null;
  image?: PdfImageSource;
  values: Record<string, number | null>;
}

export interface CartonLabelPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  cartonNumber: string;
  destinationName: string;
  identityItems: PdfKeyValueItem[];
  totalQuantity: number;
  sizeColumns: SizeColumn[];
  styleRows: CartonLabelStyleRow[];
}

function formatAddress(destination: PackingListDestinationView): string {
  return [
    destination.addressLine1,
    destination.addressLine2,
    destination.city,
    destination.state,
    destination.postalCode,
    destination.country,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded (server-persisted) Factory Packing List
 * carton + its owning destination into the plain view-model CartonLabelDocument renders.
 * Field-by-field allowlist, never `...carton`/`...destination`.
 * ISS-074: external labels omit factory identity/references and generating-user identity;
 * the source records retain authorized internal provenance unchanged.
 *
 * The destination is always the carton's owning Dispatch-Order destination record (full address
 * captured at Dispatch-Order creation) — never a live Distributor/master address lookup, which
 * could change after the label was printed. Net/Gross Weight and Dimensions are all optional and
 * simply omitted from `identityItems` when absent, rather than printed as an empty placeholder —
 * their absence must never block label generation.
 *
 * Carton contents are grouped by stable Style identity (`styleId`, never
 * display name) into one row per Style, with the configured Size master order
 * running across columns (including 9+ Sizes). Missing Style/Size cells stay
 * distinct from zero; duplicate Size entries are summed by the grouping helper.
 * Image bytes are resolved by the caller, never fetched inside the builder.
 */
export function buildCartonLabelViewModel(
  source: CartonLabelSource,
  meta: CartonLabelPdfMeta,
  styleImages?: Map<string, PdfImageSource>,
): CartonLabelPdfViewModel {
  const { carton, destination, saleOrderNumber } = source;
  const destinationName = destination.label ?? `${destination.city}, ${destination.state}`;

  const identityItems: PdfKeyValueItem[] = [{ label: 'Dispatch Order', value: saleOrderNumber }];
  identityItems.push({ label: 'Distributor', value: destination.distributor.name });
  identityItems.push({ label: 'Destination', value: destinationName });

  const address = formatAddress(destination);
  if (address) identityItems.push({ label: 'Address', value: address });
  if (destination.contactName)
    identityItems.push({ label: 'Contact', value: destination.contactName });
  if (destination.contactPhone)
    identityItems.push({ label: 'Contact Phone', value: destination.contactPhone });

  if (carton.netWeight)
    identityItems.push({ label: 'Net Weight', value: `${carton.netWeight} kg` });
  if (carton.grossWeight)
    identityItems.push({ label: 'Gross Weight', value: `${carton.grossWeight} kg` });
  if (carton.dimensions) identityItems.push({ label: 'Dimensions', value: carton.dimensions });

  return {
    title: 'CARTON LABEL',
    subtitle: `Carton ${carton.cartonNumber} — ${saleOrderNumber}`,
    generatedAt: meta.generatedAt,
    cartonNumber: carton.cartonNumber,
    destinationName,
    identityItems,
    totalQuantity: carton.totalQuantity,
    sizeColumns: distinctSizeColumns(carton.lines),
    styleRows: groupLinesByStyle(carton.lines).map((group) => {
      const image = styleImages?.get(group.styleId);
      return {
        styleId: group.styleId,
        styleNumber: group.styleNumber,
        styleName: group.styleName,
        ...(image !== undefined ? { image } : {}),
        values: Object.fromEntries(group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity])),
      };
    }),
  };
}
