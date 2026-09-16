import { StyleSheet, Text } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type {
  PackingAuditCartonDetailHistoryRow,
  PackingAuditCartonDetailLineRow,
  PackingAuditCartonDetailPdfViewModel,
} from './buildPackingAuditCartonDetailViewModel.js';

const styles = StyleSheet.create({
  warning: { fontSize: 8, color: '#8a4b00', marginBottom: 4 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginTop: 4, textAlign: 'right' },
});

const lineColumns: PdfTableColumn<PackingAuditCartonDetailLineRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '50%', value: (row) => row.styleDisplay },
  { key: 'sizeLabel', header: 'Size', width: '20%', value: (row) => row.sizeLabel },
  { key: 'quantity', header: 'Quantity', width: '30%', align: 'right', value: (row) => row.quantity },
];

const historyColumns: PdfTableColumn<PackingAuditCartonDetailHistoryRow>[] = [
  { key: 'cartonVersion', header: 'Version', width: '15%', align: 'right', value: (row) => `v${row.cartonVersion}` },
  { key: 'inspectedByName', header: 'Inspected By', width: '30%', value: (row) => row.inspectedByName },
  { key: 'inspectedAt', header: 'Inspected At', width: '25%', value: (row) => row.inspectedAt },
  { key: 'remarks', header: 'Remarks', width: '30%', value: (row) => row.remarks },
];

export interface PackingAuditCartonDetailDocumentProps {
  viewModel: PackingAuditCartonDetailPdfViewModel;
}

/** Portrait — a single carton's identity, one contents table, and a short audit-history list never need Landscape width. */
export function PackingAuditCartonDetailDocument({ viewModel }: PackingAuditCartonDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      {viewModel.retired ? <Text style={styles.warning}>This carton has been retired.</Text> : null}
      {viewModel.destinationMismatch ? (
        <Text style={styles.warning}>This carton contains a line for another destination — repacking required.</Text>
      ) : null}

      <PdfSection title="Carton Identity">
        <PdfKeyValueSection items={viewModel.identityItems} columns={2} />
      </PdfSection>

      <PdfSection title="Carton Contents" wrap>
        <PdfTable columns={lineColumns} rows={viewModel.lines} rowKey={(row) => row.id} />
        <Text style={styles.totalsLine}>Total: {viewModel.totalQuantity}</Text>
      </PdfSection>

      <PdfSection title="Audit History" wrap>
        {viewModel.auditHistory.length > 0 ? (
          <PdfTable columns={historyColumns} rows={viewModel.auditHistory} rowKey={(row) => String(row.cartonVersion)} />
        ) : (
          <Text style={styles.warning}>Not yet inspected.</Text>
        )}
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
