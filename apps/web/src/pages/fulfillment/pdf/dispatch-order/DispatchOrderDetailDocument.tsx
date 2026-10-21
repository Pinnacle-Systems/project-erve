import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { PdfStyleSizeMatrix, type PdfStyleSizeMatrixRow } from '../../../../lib/pdf/core/PdfStyleSizeMatrix.js';
import type {
  DispatchOrderDetailAuditRow,
  DispatchOrderDetailErveDispatchRow,
  DispatchOrderDetailFactoryDispatchRow,
  DispatchOrderDetailPdfViewModel,
  DispatchOrderDetailStyleRow,
} from './buildDispatchOrderDetailViewModel.js';

const styles = StyleSheet.create({
  distributorBlock: { marginBottom: 10 },
  distributorHeading: { fontSize: 10, fontWeight: 700, color: '#111111', marginBottom: 4 },
  destinationBlock: { marginBottom: 8, paddingLeft: 8 },
  destinationHeading: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 2 },
  note: { fontSize: 8, color: '#555555', marginBottom: 2 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginTop: 4, textAlign: 'right' },
});

/** Resolves each row's own image ref against the shared images Map — never `undefined`, so `PdfStyleSizeMatrix` always renders the thumbnail column (a placeholder box for a Style with no uploaded image), matching the previous flat table's "Image" column. */
function toMatrixRows(rows: DispatchOrderDetailStyleRow[], images: Map<string, PdfImageSource>): PdfStyleSizeMatrixRow[] {
  return rows.map((row) => ({
    styleId: row.styleId,
    styleNumber: row.styleNumber,
    styleName: row.styleName,
    image: row.primaryImage ? images.get(row.primaryImage.id) ?? { placeholder: true } : { placeholder: true },
    values: row.values,
  }));
}

const factoryDispatchColumns: PdfTableColumn<DispatchOrderDetailFactoryDispatchRow>[] = [
  { key: 'factoryDispatchNumber', header: 'Factory Dispatch No.', width: '60%', value: (row) => row.factoryDispatchNumber },
  { key: 'statusLabel', header: 'Status', width: '40%', value: (row) => row.statusLabel },
];

const erveDispatchColumns: PdfTableColumn<DispatchOrderDetailErveDispatchRow>[] = [
  { key: 'erveDispatchNumber', header: 'Erve Dispatch No.', width: '40%', value: (row) => row.erveDispatchNumber },
  { key: 'status', header: 'Status', width: '30%', value: (row) => row.status },
  { key: 'totalQuantity', header: 'Total Qty', width: '30%', align: 'right', value: (row) => row.totalQuantity },
];

const auditColumns: PdfTableColumn<DispatchOrderDetailAuditRow>[] = [
  { key: 'title', header: 'Event', width: '25%', value: (row) => row.title },
  { key: 'detail', header: 'Detail', width: '40%', value: (row) => row.detail },
  { key: 'actorName', header: 'Actor', width: '17%', value: (row) => row.actorName },
  { key: 'createdAt', header: 'When', width: '18%', value: (row) => row.createdAt },
];

export interface DispatchOrderDetailDocumentProps {
  viewModel: DispatchOrderDetailPdfViewModel;
  images?: Map<string, PdfImageSource>;
}

/** Landscape — the nested Distributor/Destination hierarchy and Style/Size totals tables read far better wide. */
export function DispatchOrderDetailDocument({ viewModel, images = new Map() }: DispatchOrderDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Dispatch Order Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
      </PdfSection>

      <PdfSection title="Distributors" wrap>
        {viewModel.distributorGroups.map((group) => (
          <View key={group.id} style={styles.distributorBlock}>
            <Text style={styles.distributorHeading}>
              {group.distributorName} — {group.purchaseModeLabel} (Total: {group.totalQuantity})
            </Text>
            {group.destinations.map((dest) => (
              <View key={dest.id} style={styles.destinationBlock}>
                <Text style={styles.destinationHeading}>
                  {dest.label} (Total: {dest.totalQuantity})
                </Text>
                <Text style={styles.note}>{dest.addressLine}</Text>
                {dest.contactLine ? <Text style={styles.note}>{dest.contactLine}</Text> : null}
                {dest.gstin ? <Text style={styles.note}>GSTIN: {dest.gstin}</Text> : null}
                <PdfStyleSizeMatrix columns={dest.sizeColumns} rows={toMatrixRows(dest.styleRows, images)} />
              </View>
            ))}
          </View>
        ))}
      </PdfSection>

      <PdfSection title="Style / Size Totals" wrap>
        <PdfStyleSizeMatrix columns={viewModel.overallSizeColumns} rows={toMatrixRows(viewModel.overallStyleRows, images)} />
        <Text style={styles.totalsLine}>Total: {viewModel.grandTotalQuantity}</Text>
      </PdfSection>

      {viewModel.factoryDispatches || viewModel.erveDispatches ? (
        <PdfSection title="Factory / Erve Dispatch Records" wrap>
          {viewModel.factoryDispatches ? (
            viewModel.factoryDispatches.length > 0 ? (
              <PdfTable columns={factoryDispatchColumns} rows={viewModel.factoryDispatches} rowKey={(row) => row.id} />
            ) : (
              <Text style={styles.note}>No Factory Dispatches yet.</Text>
            )
          ) : null}
          {viewModel.erveDispatches ? (
            viewModel.erveDispatches.length > 0 ? (
              <PdfTable columns={erveDispatchColumns} rows={viewModel.erveDispatches} rowKey={(row) => row.id} />
            ) : (
              <Text style={styles.note}>No Erve Dispatches yet.</Text>
            )
          ) : null}
        </PdfSection>
      ) : null}

      {viewModel.auditTrail ? (
        <PdfSection title="Audit Trail" wrap>
          {viewModel.auditTrail.length > 0 ? (
            <PdfTable columns={auditColumns} rows={viewModel.auditTrail} rowKey={(row) => row.id} />
          ) : (
            <Text style={styles.note}>No audit events yet.</Text>
          )}
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
