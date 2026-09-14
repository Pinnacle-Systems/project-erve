import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import { PdfThumbnail } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { formatPdfValue } from '../../../../lib/pdf/format.js';
import type {
  PpSampleEvidenceItem,
  PpSampleFormRow,
  PpSamplePdfViewModel,
  PpSampleReworkRow,
  PpSampleSessionRow,
} from './buildPpSampleViewModel.js';

const styles = StyleSheet.create({
  formBlock: {
    marginBottom: 10,
    padding: 8,
    borderRadius: 2,
    border: '0.5 solid #dddddd',
    backgroundColor: '#fafafa',
  },
  formHeading: { fontSize: 9, fontWeight: 700, color: '#333333', marginBottom: 4 },
  note: { fontSize: 8, color: '#777777', marginBottom: 6 },
  checklistHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#eeeeee',
    borderBottom: '1 solid #333333',
    paddingVertical: 4,
  },
  checklistHeaderCell: { fontSize: 8, fontWeight: 700, color: '#333333', paddingHorizontal: 4 },
  checklistRow: { flexDirection: 'row', borderBottom: '0.5 solid #dddddd', paddingVertical: 4 },
  checklistCell: { fontSize: 8, color: '#111111', paddingHorizontal: 4 },
  remarksText: { fontSize: 8, color: '#333333', marginTop: 4 },
  evidenceHeading: { fontSize: 8, fontWeight: 700, color: '#555555', marginTop: 4, marginBottom: 4 },
  evidenceRow: { flexDirection: 'row', flexWrap: 'wrap' },
  evidenceItem: { width: 90, marginRight: 10, marginBottom: 8 },
  evidenceFileName: { fontSize: 7, color: '#333333', marginTop: 3 },
  nonImageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottom: '0.5 solid #dddddd',
    paddingVertical: 3,
    width: '100%',
  },
  nonImageCell: { fontSize: 8, color: '#111111' },
  emptyText: { fontSize: 8, color: '#777777' },
});

const reworkColumns: PdfTableColumn<PpSampleReworkRow>[] = [
  { key: 'styleNumber', header: 'Style', width: '25%', value: (row) => row.styleNumber },
  { key: 'sizeCode', header: 'Size', width: '15%', value: (row) => row.sizeCode },
  { key: 'quantity', header: 'Quantity', width: '15%', align: 'right', value: (row) => row.quantity },
  { key: 'attemptNumber', header: 'Attempt', width: '15%', align: 'right', value: (row) => row.attemptNumber },
  { key: 'statusLabel', header: 'Status', width: '30%', value: (row) => row.statusLabel },
];

function EvidenceGrid({ items }: { items: PpSampleEvidenceItem[] }) {
  if (items.length === 0) return <Text style={styles.emptyText}>No evidence uploaded.</Text>;
  return (
    <View style={styles.evidenceRow}>
      {items.map((item) =>
        item.isImage ? (
          <View key={item.id} style={styles.evidenceItem}>
            <PdfThumbnail image={item.image} width={90} height={90} />
            <Text style={styles.evidenceFileName}>{item.fileName}</Text>
          </View>
        ) : (
          <View key={item.id} style={styles.nonImageRow}>
            <Text style={styles.nonImageCell}>{item.fileName}</Text>
            <Text style={styles.nonImageCell}>{item.contentType}</Text>
          </View>
        ),
      )}
    </View>
  );
}

function FormBlock({ form }: { form: PpSampleFormRow }) {
  return (
    <View style={styles.formBlock} wrap={false}>
      <Text style={styles.formHeading}>{`Size ${form.sizeLabel} — ${form.styleNumber}`}</Text>
      <PdfKeyValueSection
        items={[
          { label: 'Sample Quantity', value: form.sampleQuantity },
          { label: 'Decision', value: form.decisionLabel },
          { label: 'Form Status', value: form.statusLabel },
        ]}
        columns={3}
      />
      {form.checklist.length > 0 ? (
        <View>
          <View style={styles.checklistHeaderRow} fixed>
            <Text style={[styles.checklistHeaderCell, { width: '55%' }]}>Checklist Item</Text>
            <Text style={[styles.checklistHeaderCell, { width: '20%' }]}>Result</Text>
            <Text style={[styles.checklistHeaderCell, { width: '25%' }]}>Remarks</Text>
          </View>
          {form.checklist.map((item, index) => (
            <View key={`${item.label}-${index}`} style={styles.checklistRow} wrap={false}>
              <Text style={[styles.checklistCell, { width: '55%' }]}>{item.label}</Text>
              <Text style={[styles.checklistCell, { width: '20%' }]}>{formatPdfValue(item.status)}</Text>
              <Text style={[styles.checklistCell, { width: '25%' }]}>{formatPdfValue(item.remarks)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {form.inspectionRemarks ? (
        <Text style={styles.remarksText}>{`Inspection remarks: ${form.inspectionRemarks}`}</Text>
      ) : null}
      <Text style={styles.evidenceHeading}>Evidence</Text>
      <EvidenceGrid items={form.evidence} />
    </View>
  );
}

function SessionBlock({ session }: { session: PpSampleSessionRow }) {
  return (
    <PdfSection title={session.cycleLabel} wrap>
      <Text style={styles.note}>{`${session.inspectorName} · ${session.finalizedLabel ?? 'Draft'}`}</Text>
      <PdfKeyValueSection items={[{ label: 'Status', value: session.statusLabel }]} columns={4} />
      {session.forms.map((form) => (
        <FormBlock key={form.id} form={form} />
      ))}
      {session.sessionEvidence.length > 0 ? (
        <View>
          <Text style={styles.evidenceHeading}>Additional Session Evidence</Text>
          <EvidenceGrid items={session.sessionEvidence} />
        </View>
      ) : null}
    </PdfSection>
  );
}

export interface PpSampleDocumentProps {
  viewModel: PpSamplePdfViewModel;
}

/** Landscape — the checklist item labels are long-form sentences and need the extra width. */
export function PpSampleDocument({ viewModel }: PpSampleDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Inspection Context">
        <PdfKeyValueSection items={viewModel.headerItems} columns={4} />
      </PdfSection>

      {viewModel.sessions.length === 0 ? (
        <PdfSection title="Inspection History">
          <Text style={styles.emptyText}>No inspection history available.</Text>
        </PdfSection>
      ) : (
        viewModel.sessions.map((session) => <SessionBlock key={session.id} session={session} />)
      )}

      <PdfSection title="Rework Status" wrap>
        {viewModel.reworkTasks.length === 0 ? (
          <Text style={styles.emptyText}>No rework.</Text>
        ) : (
          <PdfTable columns={reworkColumns} rows={viewModel.reworkTasks} rowKey={(row) => row.id} />
        )}
      </PdfSection>

      <PdfSection title="Downstream Availability">
        <Text style={styles.note}>{viewModel.downstreamAvailabilityText}</Text>
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
