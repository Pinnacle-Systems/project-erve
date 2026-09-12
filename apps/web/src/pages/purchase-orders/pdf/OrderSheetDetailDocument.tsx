import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type {
  OrderSheetDetailLineSection,
  OrderSheetDetailPdfViewModel,
  OrderSheetDetailSizeRow,
} from './buildOrderSheetDetailViewModel.js';

const styles = StyleSheet.create({
  lineBlock: { marginBottom: 10 },
  lineHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  lineTitle: { fontSize: 9, fontWeight: 700, color: '#111111' },
  lineSubtitle: { fontSize: 8, color: '#555555', marginTop: 1 },
  lineTotal: { fontSize: 9, fontWeight: 700, color: '#111111' },
});

const sizeColumns: PdfTableColumn<OrderSheetDetailSizeRow>[] = [
  { key: 'sizeCode', header: 'Size', width: '60%', value: (row) => row.sizeCode },
  { key: 'orderedQuantity', header: 'Forecast Qty', width: '40%', align: 'right', value: (row) => row.orderedQuantity },
];

function LineBlock({ line }: { line: OrderSheetDetailLineSection }) {
  return (
    <View style={styles.lineBlock} wrap={false}>
      <View style={styles.lineHeaderRow}>
        <View>
          <Text style={styles.lineTitle}>
            {line.styleNumber} {line.styleName}
          </Text>
          {line.seasonDisplay ? <Text style={styles.lineSubtitle}>{line.seasonDisplay}</Text> : null}
        </View>
        <Text style={styles.lineTotal}>Total: {line.totalOrderedQuantity}</Text>
      </View>
      <PdfTable columns={sizeColumns} rows={line.sizes} rowKey={(row) => row.id} />
    </View>
  );
}

export interface OrderSheetDetailDocumentProps {
  viewModel: OrderSheetDetailPdfViewModel;
}

/** Landscape — the size-wise quantity matrix is the primary business section and reads best wide. */
export function OrderSheetDetailDocument({ viewModel }: OrderSheetDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Order Sheet Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
      </PdfSection>

      <PdfSection title="Style and Size-wise Quantities" wrap>
        {viewModel.lines.map((line) => (
          <LineBlock key={line.id} line={line} />
        ))}
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
