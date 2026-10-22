import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfStyleSizeMatrix } from '../../../../lib/pdf/core/PdfStyleSizeMatrix.js';
import type {
  ErvePackingListDetailCartonRow,
  ErvePackingListDetailPdfViewModel,
} from './buildErvePackingListDetailViewModel.js';

const styles = StyleSheet.create({
  cartonBlock: { marginTop: 6, marginBottom: 6, paddingLeft: 8 },
  cartonHeading: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 2 },
  cartonMeta: { fontSize: 8, color: '#555555', marginBottom: 2 },
  noCartons: { fontSize: 8, color: '#777777', marginTop: 4 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginTop: 4, textAlign: 'right' },
  dispatchNote: { fontSize: 9, color: '#0a6e1e', marginBottom: 8 },
  // Match PdfFooter's chrome without its dynamic callback (global numbering is stamped later).
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 28,
    right: 28,
    fontSize: 8,
    color: '#777777',
    textAlign: 'center',
    borderTop: '0.5 solid #cccccc',
    paddingTop: 6,
  },
});

// DEMO-020: carton.factoryName/factoryDispatchNumber are confidential
// factory/supplier provenance and are null (not rendered — no stray
// separators or placeholder text) whenever the source record omitted them.
// Exported so the redaction can be asserted directly against the string the
// PDF prints, rather than only parsing the rendered PDF binary.
export function cartonHeading(carton: ErvePackingListDetailCartonRow): string {
  const parts = [`Carton ${carton.cartonNumber}`];
  if (carton.factoryName) parts.push(carton.factoryName);
  parts.push(carton.saleOrderNumber);
  const segments = [parts.join(' — ')];
  if (carton.factoryDispatchNumber) segments.push(`(${carton.factoryDispatchNumber})`);
  if (carton.weight) segments.push(`— ${carton.weight}`);
  return segments.join(' ');
}

function CartonBlock({ carton }: { carton: ErvePackingListDetailCartonRow }) {
  return (
    <View style={styles.cartonBlock}>
      <Text style={styles.cartonHeading}>{cartonHeading(carton)}</Text>
      {carton.packageDetails ? (
        <Text style={styles.cartonMeta}>{carton.packageDetails}</Text>
      ) : null}
      <PdfStyleSizeMatrix
        columns={carton.sizeColumns}
        rows={carton.styleRows}
        maxColumnsPerGroup={10}
        keepBoundaryRows
        flattenForPagination
      />
    </View>
  );
}

export interface ErvePackingListDetailDocumentProps {
  viewModel: ErvePackingListDetailPdfViewModel;
  first?: boolean;
  last?: boolean;
}

/** Landscape — one EIPL may consolidate cartons from several Factories/Dispatch Orders, and each carton's own provenance must stay visible without cramping. */
export function ErvePackingListDetailDocument({
  viewModel,
  first = true,
  last = true,
}: ErvePackingListDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      {first ? (
        <>
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
        </>
      ) : null}

      <PdfSection title={first ? 'Cartons' : 'Cartons (continued)'} wrap>
        {viewModel.cartons.length > 0 ? (
          viewModel.cartons.map((carton) => <CartonBlock key={carton.id} carton={carton} />)
        ) : (
          <Text style={styles.noCartons}>No cartons selected yet.</Text>
        )}
        {last ? (
          <Text style={styles.totalsLine}>
            Total: {viewModel.totalCartonCount} cartons · {viewModel.totalQuantity} pieces
          </Text>
        ) : null}
      </PdfSection>

      {last && viewModel.styleSizeSummaryRows.length > 0 ? (
        <PdfSection title="Style / Size Summary" wrap>
          <PdfStyleSizeMatrix
            columns={viewModel.styleSizeSizeColumns}
            rows={viewModel.styleSizeSummaryRows}
            maxColumnsPerGroup={10}
            keepBoundaryRows
            flattenForPagination
          />
        </PdfSection>
      ) : null}

      <Text style={styles.footer} fixed>
        {' '}
      </Text>
    </PdfDocument>
  );
}
