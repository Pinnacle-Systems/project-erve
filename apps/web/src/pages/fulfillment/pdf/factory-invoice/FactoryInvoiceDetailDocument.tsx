import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import type { FactoryInvoiceDetailLineRow, FactoryInvoiceDetailPdfViewModel } from './buildFactoryInvoiceDetailViewModel.js';

const styles = StyleSheet.create({
  cellText: { fontSize: 8, color: '#111111' },
  overriddenNote: { fontSize: 7, color: '#8a4b00' },
  totalsBlock: { marginTop: 4, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', width: '45%', paddingVertical: 2 },
  totalsLabel: { fontSize: 9, color: '#333333' },
  totalsValue: { fontSize: 9, color: '#111111', textAlign: 'right' },
  grandTotalLabel: { fontSize: 10, fontWeight: 700, color: '#111111' },
  grandTotalValue: { fontSize: 10, fontWeight: 700, color: '#111111', textAlign: 'right' },
  divider: { borderTop: '1 solid #333333', width: '45%', marginTop: 2, marginBottom: 2 },
  provisionalBanner: { borderWidth: 1, borderColor: '#B45309', backgroundColor: '#FFFBEB', padding: 6, marginBottom: 6 },
  provisionalText: { fontSize: 8, fontWeight: 700, color: '#B45309', textAlign: 'center' },
});

const lineColumns: PdfTableColumn<FactoryInvoiceDetailLineRow>[] = [
  { key: 'styleDisplay', header: 'Style', width: '28%', value: (row) => row.styleDisplay },
  { key: 'sizeBreakdown', header: 'Size Breakdown', width: '32%', value: (row) => row.sizeBreakdown },
  { key: 'totalQuantity', header: 'Total Qty', width: '12%', align: 'right', value: (row) => row.totalQuantity },
  {
    key: 'rate',
    header: 'Rate',
    width: '14%',
    align: 'right',
    render: (row) => (
      <View>
        <Text style={[styles.cellText, { textAlign: 'right' }]}>{row.rate}</Text>
        {row.rateOverridden ? <Text style={[styles.overriddenNote, { textAlign: 'right' }]}>default {row.defaultRate}</Text> : null}
      </View>
    ),
  },
  { key: 'amount', header: 'Amount', width: '14%', align: 'right', value: (row) => row.amount },
];

export interface FactoryInvoiceDetailDocumentProps {
  viewModel: FactoryInvoiceDetailPdfViewModel;
}

/** Portrait — a single Style/Size/Rate lines table plus a totals block reads like a standard invoice document; no wide multi-level hierarchy here. */
export function FactoryInvoiceDetailDocument({ viewModel }: FactoryInvoiceDetailDocumentProps) {
  return (
    <PdfDocument orientation="portrait">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Invoice Details">
        <PdfKeyValueSection items={viewModel.identityItems} columns={2} />
      </PdfSection>

      <PdfSection title="Lines" wrap>
        <PdfTable columns={lineColumns} rows={viewModel.lines} rowKey={(row) => row.id} />
      </PdfSection>

      <PdfSection title="Totals">
        {!viewModel.isFinalized ? (
          <View style={styles.provisionalBanner}>
            <Text style={styles.provisionalText}>
              PROVISIONAL — Not yet finalized. GST and Total are subject to change until the invoice is finalized.
            </Text>
          </View>
        ) : null}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{viewModel.subtotal}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>GST</Text>
            <Text style={styles.totalsValue}>{viewModel.gstAmount}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalsRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{viewModel.total}</Text>
          </View>
        </View>
      </PdfSection>

      {viewModel.remarks ? (
        <PdfSection title="Remarks">
          <Text style={styles.cellText}>{viewModel.remarks}</Text>
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
