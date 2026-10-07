import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { FactoryPackingCartonView, PackingListDestinationView } from '../../types.js';

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

export interface CartonLabelLineRow {
  id: string;
  styleDisplay: string;
  sizeLabel: string;
  quantity: number;
}

export interface CartonLabelPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  cartonNumber: string;
  destinationName: string;
  identityItems: PdfKeyValueItem[];
  totalQuantity: number;
  lines: CartonLabelLineRow[];
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
 *
 * The destination is always the carton's owning Dispatch-Order destination record (full address
 * captured at Dispatch-Order creation) — never a live Distributor/master address lookup, which
 * could change after the label was printed. Net/Gross Weight and Dimensions are all optional and
 * simply omitted from `identityItems` when absent, rather than printed as an empty placeholder —
 * their absence must never block label generation.
 */
export function buildCartonLabelViewModel(source: CartonLabelSource, meta: CartonLabelPdfMeta): CartonLabelPdfViewModel {
  const { carton, destination, saleOrderNumber, factoryName, factoryDispatchNumber } = source;
  const destinationName = destination.label ?? `${destination.city}, ${destination.state}`;

  const identityItems: PdfKeyValueItem[] = [
    { label: 'Dispatch Order', value: saleOrderNumber },
    { label: 'Factory', value: factoryName },
  ];
  if (factoryDispatchNumber) identityItems.push({ label: 'Factory Dispatch', value: factoryDispatchNumber });
  identityItems.push({ label: 'Distributor', value: destination.distributor.name });
  identityItems.push({ label: 'Destination', value: destinationName });

  const address = formatAddress(destination);
  if (address) identityItems.push({ label: 'Address', value: address });
  if (destination.contactName) identityItems.push({ label: 'Contact', value: destination.contactName });
  if (destination.contactPhone) identityItems.push({ label: 'Contact Phone', value: destination.contactPhone });

  if (carton.netWeight) identityItems.push({ label: 'Net Weight', value: `${carton.netWeight} kg` });
  if (carton.grossWeight) identityItems.push({ label: 'Gross Weight', value: `${carton.grossWeight} kg` });
  if (carton.dimensions) identityItems.push({ label: 'Dimensions', value: carton.dimensions });

  return {
    title: 'CARTON LABEL',
    subtitle: `Carton ${carton.cartonNumber} — ${saleOrderNumber} · ${factoryName}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    cartonNumber: carton.cartonNumber,
    destinationName,
    identityItems,
    totalQuantity: carton.totalQuantity,
    lines: carton.lines.map((line) => ({
      id: line.saleOrderLineId,
      styleDisplay: `${line.styleNumber} — ${line.styleName}`,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
    })),
  };
}
