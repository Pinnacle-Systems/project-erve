import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type {
  ErvePackingListDetailCartonLineRow,
  ErvePackingListDetailCartonRow,
  ErvePackingListDetailPdfViewModel,
  ErvePackingListDetailStyleSizeRow,
} from './buildErvePackingListDetailViewModel.js';

const styles = StyleSheet.create({
  cartonBlock: { marginTop: 6, marginBottom: 6, paddingLeft: 8 },
  cartonHeading: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 2 },
  cartonMeta: { fontSize: 8, color: '#555555', marginBottom: 2 },
  noCartons: { fontSize: 8, color: '#777777', marginTop: 4 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginTop: 4, textAlign: 'right' },
  dispatchNote: { fontSize: 9, color: '#0a6e1e', marginBottom: 8 },
});

const cartonLineColumns: PdfTableColumn<ErvePackingListDetailCartonLineRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '55%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '20%', value: (row) => row.sizeLabel },
  { key: 'quantity', header: 'Quantity', width: '25%', align: 'right', value: (row) => row.quantity },
];

function CartonBlock({ carton }: { carton: ErvePackingListDetailCartonRow }) {
  return (
    <View style={styles.cartonBlock}>
      <Text style={styles.cartonHeading}>
        Carton {carton.cartonNumber} — {carton.factoryName} — {carton.saleOrderNumber} ({carton.factoryDispatchNumber})
        {carton.weight ? ` — ${carton.weight}` : ''}
      </Text>
      {carton.packageDetails ? <Text style={styles.cartonMeta}>{carton.packageDetails}</Text> : null}
      <PdfTable columns={cartonLineColumns} rows={carton.lines} rowKey={(row) => row.saleOrderLineId} />
    </View>
  );
}

const styleSizeColumns: PdfTableColumn<ErvePackingListDetailStyleSizeRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '55%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '20%', value: (row) => row.sizeLabel },
  { key: 'quantity', header: 'Quantity', width: '25%', align: 'right', value: (row) => row.quantity },
];

export interface ErvePackingListDetailDocumentProps {
  viewModel: ErvePackingListDetailPdfViewModel;
}

/** Landscape — one EIPL may consolidate cartons from several Factories/Dispatch Orders, and each carton's own provenance must stay visible without cramping. */
export function ErvePackingListDetailDocument({ viewModel }: ErvePackingListDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      {viewModel.dispatchReference ? (
        <Text style={styles.dispatchNote}>Dispatched as {viewModel.dispatchReference}.</Text>
      ) : null}

      <PdfSection title="Erve Packing List Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
      </PdfSection>

      <PdfSection title="Destination">
        <PdfKeyValueSection items={viewModel.destinationItems} columns={3} />
      </PdfSection>

      <PdfSection title="Cartons" wrap>
        {viewModel.cartons.length > 0 ? (
          viewModel.cartons.map((carton) => <CartonBlock key={carton.id} carton={carton} />)
        ) : (
          <Text style={styles.noCartons}>No cartons selected yet.</Text>
        )}
        <Text style={styles.totalsLine}>
          Total: {viewModel.totalCartonCount} cartons · {viewModel.totalQuantity} pieces
        </Text>
      </PdfSection>

      {viewModel.styleSizeSummary.length > 0 ? (
        <PdfSection title="Style / Size Summary" wrap>
          <PdfTable columns={styleSizeColumns} rows={viewModel.styleSizeSummary} rowKey={(row) => row.key} />
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
