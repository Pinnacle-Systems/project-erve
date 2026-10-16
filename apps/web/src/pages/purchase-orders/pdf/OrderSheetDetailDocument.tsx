import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfThumbnail, type PdfImageSource } from '../../../lib/pdf/core/PdfThumbnail.js';
import {
  PdfStyleSizeMatrix,
  type PdfStyleSizeMatrixColumn,
  type PdfStyleSizeMatrixRow,
} from '../../../lib/pdf/core/PdfStyleSizeMatrix.js';
import type {
  OrderSheetDetailLineSection,
  OrderSheetDetailPdfViewModel,
} from './buildOrderSheetDetailViewModel.js';

const styles = StyleSheet.create({
  identityRow: { flexDirection: 'row', alignItems: 'flex-start' },
  imageWrapper: { marginRight: 16 },
  identityContent: { flex: 1 },
  lineBlock: { marginBottom: 10 },
  lineHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  lineTitle: { fontSize: 9, fontWeight: 700, color: '#111111' },
  lineSubtitle: { fontSize: 8, color: '#555555', marginTop: 1 },
  lineTotal: { fontSize: 9, fontWeight: 700, color: '#111111' },
  remarksText: { fontSize: 8, color: '#333333', lineHeight: 1.4 },
});

function LineBlock({ line, image }: { line: OrderSheetDetailLineSection; image: PdfImageSource }) {
  // An Order Sheet line is exactly one Style (server-enforced) — the matrix always receives a
  // single row here, but is built the same way a multi-Style document would, so a future relaxation
  // of that business rule would only need more rows pushed in, not a different rendering path.
  const columns: PdfStyleSizeMatrixColumn[] = line.sizes.map((size) => ({
    sizeId: size.sizeId,
    sizeCode: size.sizeCode,
  }));
  const row: PdfStyleSizeMatrixRow = {
    styleId: line.styleId,
    styleNumber: line.styleNumber,
    styleName: line.styleName,
    image,
    values: Object.fromEntries(line.sizes.map((size) => [size.sizeId, size.orderedQuantity])),
  };
  return (
    // No outer `wrap={false}` here — an Order Sheet line is always exactly one Style/one row
    // today, so this never truly needs to paginate, but forcing the whole block together would
    // silently defeat PdfStyleSizeMatrix's own pagination support for any future reuse of this
    // pattern with more rows. The header row itself stays atomic (wrap={false}) so it never
    // orphans from the matrix that follows it.
    <View style={styles.lineBlock}>
      <View style={styles.lineHeaderRow} wrap={false}>
        <View>
          <Text style={styles.lineTitle}>
            {line.styleNumber} {line.styleName}
          </Text>
          {line.seasonDisplay ? <Text style={styles.lineSubtitle}>{line.seasonDisplay}</Text> : null}
        </View>
        <Text style={styles.lineTotal}>Total: {line.totalOrderedQuantity}</Text>
      </View>
      <PdfStyleSizeMatrix columns={columns} rows={[row]} showColumnTotals={false} />
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
        <View style={styles.identityRow}>
          <View style={styles.imageWrapper}>
            <PdfThumbnail image={viewModel.image} width={90} height={90} />
          </View>
          <View style={styles.identityContent}>
            <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
          </View>
        </View>
      </PdfSection>

      <PdfSection title="Style and Size-wise Quantities" wrap>
        {viewModel.lines.map((line) => (
          <LineBlock key={line.id} line={line} image={viewModel.image} />
        ))}
      </PdfSection>

      {viewModel.remarks ? (
        <PdfSection title="Remarks" wrap>
          <Text style={styles.remarksText}>{viewModel.remarks}</Text>
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
