import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type {
  FactoryPackingListCartonLineRow,
  FactoryPackingListCartonRow,
  FactoryPackingListLineRow,
  FactoryPackingListPdfViewModel,
  FactoryPackingListRetiredCartonRow,
} from './buildFactoryPackingListViewModel.js';

const styles = StyleSheet.create({
  destinationBlock: { marginBottom: 12 },
  destinationHeading: { fontSize: 10, fontWeight: 700, color: '#111111', marginBottom: 4 },
  note: { fontSize: 8, color: '#555555', marginBottom: 4 },
  cartonBlock: { marginTop: 6, marginBottom: 6, paddingLeft: 8 },
  cartonHeading: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 2 },
  cartonMeta: { fontSize: 8, color: '#555555', marginBottom: 2 },
  noCartons: { fontSize: 8, color: '#777777', marginTop: 4 },
});

const lineColumns: PdfTableColumn<FactoryPackingListLineRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '50%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '15%', value: (row) => row.sizeLabel },
  { key: 'requiredQuantity', header: 'Required', width: '17.5%', align: 'right', value: (row) => row.requiredQuantity },
  { key: 'packedQuantity', header: 'Packed', width: '17.5%', align: 'right', value: (row) => row.packedQuantity },
];

const cartonLineColumns: PdfTableColumn<FactoryPackingListCartonLineRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '55%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '20%', value: (row) => row.sizeLabel },
  { key: 'quantity', header: 'Quantity', width: '25%', align: 'right', value: (row) => row.quantity },
];

function CartonBlock({ carton }: { carton: FactoryPackingListCartonRow }) {
  return (
    <View style={styles.cartonBlock}>
      <Text style={styles.cartonHeading}>
        Carton {carton.cartonNumber}
        {carton.weight ? ` — ${carton.weight}` : ''} — {carton.auditStateLabel}
        {carton.destinationMismatch ? ' — Destination mismatch (repack required)' : ''}
      </Text>
      {carton.packageDetails ? <Text style={styles.cartonMeta}>{carton.packageDetails}</Text> : null}
      <PdfTable columns={cartonLineColumns} rows={carton.lines} rowKey={(row) => row.id} />
    </View>
  );
}

const retiredCartonColumns: PdfTableColumn<FactoryPackingListRetiredCartonRow>[] = [
  { key: 'cartonNumber', header: 'Carton', width: '20%', value: (row) => row.cartonNumber },
  { key: 'auditStateLabel', header: 'Last Audit State', width: '25%', value: (row) => row.auditStateLabel },
  { key: 'retiredAt', header: 'Retired At', width: '25%', value: (row) => (row.retiredAt ? formatPdfDateTime(row.retiredAt) : null) },
  {
    key: 'contents',
    header: 'Contents',
    width: '30%',
    value: (row) => row.lines.map((l) => `${l.styleDisplay} / ${l.sizeLabel}: ${l.quantity}`).join('; '),
  },
];

export interface FactoryPackingListDetailDocumentProps {
  viewModel: FactoryPackingListPdfViewModel;
}

/** Landscape — the Destination -> Carton -> Line hierarchy and required/packed table read far better wide. */
export function FactoryPackingListDetailDocument({ viewModel }: FactoryPackingListDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Factory Packing List Details">
        <PdfKeyValueSection
          items={[
            { label: 'Dispatch Order Number', value: viewModel.saleOrderNumber },
            { label: 'Factory', value: viewModel.factoryName },
            { label: 'Distributors', value: viewModel.distributorsDisplay },
            { label: 'Factory Dispatch Number', value: viewModel.factoryDispatchNumber },
            { label: 'Status', value: viewModel.statusLabel },
          ]}
          columns={4}
        />
      </PdfSection>

      <PdfSection title="Destinations" wrap>
        {viewModel.destinations.map((destination) => (
          <View key={destination.id} style={styles.destinationBlock}>
            <Text style={styles.destinationHeading}>
              {destination.label} — {destination.distributorName}
            </Text>
            <Text style={styles.note}>
              {[destination.addressLine, destination.contactName].filter(Boolean).join(' · ')}
            </Text>
            <PdfTable columns={lineColumns} rows={destination.lines} rowKey={(row) => row.id} />
            {destination.cartons.length > 0 ? (
              destination.cartons.map((carton) => <CartonBlock key={carton.id} carton={carton} />)
            ) : (
              <Text style={styles.noCartons}>No cartons yet.</Text>
            )}
          </View>
        ))}
      </PdfSection>

      {viewModel.retiredCartons.length > 0 ? (
        <PdfSection title="Retired Cartons (historical)" wrap>
          <PdfTable columns={retiredCartonColumns} rows={viewModel.retiredCartons} rowKey={(row) => row.id} />
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
