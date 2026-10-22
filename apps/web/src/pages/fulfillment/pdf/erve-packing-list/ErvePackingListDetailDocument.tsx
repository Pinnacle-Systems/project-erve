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
  summaryTitle: { fontSize: 10, fontWeight: 700, marginBottom: 6, color: '#333333' },
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

// ISS-054: the carton heading never prints internal factory provenance, the
// EISO Dispatch Order number, or the EIFD Factory Dispatch number on this
// external, distributor-facing PDF — physical carton identity is carried
// entirely by the Factory's own hand-marked cartonNumber (see DEMO-019).
// Exported so the redaction can be asserted directly against the string the
// PDF prints, rather than only parsing the rendered PDF binary.
export function cartonHeading(carton: ErvePackingListDetailCartonRow): string {
  const segments = [`Carton ${carton.cartonNumber}`];
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
        repeatPageHeaders
      />
    </View>
  );
}

export interface ErvePackingListDetailDocumentProps {
  viewModel: ErvePackingListDetailPdfViewModel;
  first?: boolean;
  last?: boolean;
}

/** Landscape — the Style/Size matrix columns need the width even though carton headings no longer print per-carton provenance (ISS-054). */
export function ErvePackingListDetailDocument({
  viewModel,
  first = true,
  last = true,
}: ErvePackingListDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape" experimentalPagination>
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <Text style={styles.footer} fixed>
        {' '}
      </Text>
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
        <View>
          <Text style={styles.summaryTitle} minPresenceAhead={48}>
            Style / Size Summary
          </Text>
          <PdfStyleSizeMatrix
            columns={viewModel.styleSizeSizeColumns}
            rows={viewModel.styleSizeSummaryRows}
            maxColumnsPerGroup={10}
            keepBoundaryRows
            flattenForPagination
            repeatPageHeaders
          />
        </View>
      ) : null}
    </PdfDocument>
  );
}
