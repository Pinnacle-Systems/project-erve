import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { CartonLabelStyleRow, CartonLabelPdfViewModel } from './buildCartonLabelViewModel.js';

const styles = StyleSheet.create({
  identityBlock: { marginBottom: 14, paddingBottom: 10, borderBottom: '1 solid #999999' },
  cartonNumber: { fontSize: 26, fontWeight: 700, color: '#111111' },
  destinationName: { fontSize: 13, fontWeight: 700, color: '#111111', marginTop: 4 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginTop: 4, textAlign: 'right' },
});

const styleRowColumns: PdfTableColumn<CartonLabelStyleRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '45%', value: (row) => row.styleDisplay },
  {
    key: 'sizeBreakdown',
    header: 'Size Breakdown',
    width: '35%',
    value: (row) => row.sizeBreakdown,
  },
  { key: 'quantity', header: 'Total', width: '20%', align: 'right', value: (row) => row.quantity },
];

export interface CartonLabelDocumentProps {
  viewModel: CartonLabelPdfViewModel;
}

/**
 * Portrait, single carton per document — the carton number and destination are rendered large at
 * the top so the printed sheet reads at a glance once attached to the physical carton, with the
 * full identity/contents detail below for traceability.
 */
export function CartonLabelDocument({ viewModel }: CartonLabelDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} />

      <View style={styles.identityBlock}>
        <Text style={styles.cartonNumber}>Carton {viewModel.cartonNumber}</Text>
        <Text style={styles.destinationName}>{viewModel.destinationName}</Text>
      </View>

      <PdfSection title="Carton Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={2} />
      </PdfSection>

      <PdfSection title="Carton Contents" wrap>
        <PdfTable columns={styleRowColumns} rows={viewModel.styleRows} rowKey={(row) => row.id} />
        <Text style={styles.totalsLine}>Total: {viewModel.totalQuantity}</Text>
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
