import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfThumbnail } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import { formatPdfValue } from '../../../../lib/pdf/format.js';
import { QualityBlocksRenderer } from '../shared/QualityBlocksRenderer.js';
import type {
  ConsolidatedFinalInspectionAllocationRow,
  ConsolidatedFinalInspectionAttemptViewModel,
  ConsolidatedFinalInspectionBatchViewModel,
  ConsolidatedFinalInspectionPdfViewModel,
  ConsolidatedFinalInspectionSummaryRow,
} from './buildConsolidatedFinalInspectionViewModel.js';

const styles = StyleSheet.create({
  identityRow: { flexDirection: 'row', alignItems: 'flex-start' },
  imageWrapper: { marginRight: 16 },
  identityContent: { flex: 1 },
  note: { fontSize: 8, color: '#777777', marginBottom: 6 },
  releaseBanner: { fontSize: 9, color: '#166534', marginTop: 6 },
  cancelledBanner: { fontSize: 9, color: '#991b1b', marginBottom: 6 },
  attemptHeading: { fontSize: 9, fontWeight: 700, marginBottom: 4, color: '#1f2937' },
  outcomeText: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
});

const summaryColumns: PdfTableColumn<ConsolidatedFinalInspectionSummaryRow>[] = [
  { key: 'batchNumber', header: 'Batch', width: '10%', align: 'right', value: (row) => row.batchNumber },
  { key: 'physicalQuantity', header: 'Physical Qty', width: '15%', align: 'right', value: (row) => row.physicalQuantity },
  { key: 'attemptCount', header: 'Attempts', width: '13%', align: 'right', value: (row) => row.attemptCount },
  { key: 'latestOutcomeLabel', header: 'Latest Outcome', width: '16%', value: (row) => row.latestOutcomeLabel },
  { key: 'dispositionLabel', header: 'Disposition', width: '26%', value: (row) => row.dispositionLabel },
  { key: 'releasedQuantity', header: 'Released Qty', width: '20%', align: 'right', value: (row) => row.releasedQuantity },
];

const allocationColumns: PdfTableColumn<ConsolidatedFinalInspectionAllocationRow>[] = [
  { key: 'label', header: 'Size', width: '60%', value: (row) => row.label },
  { key: 'quantity', header: 'Quantity', width: '40%', align: 'right', value: (row) => row.quantity },
];

function AttemptSection({ attempt }: { attempt: ConsolidatedFinalInspectionAttemptViewModel }) {
  return (
    <PdfSection title={`Attempt ${attempt.attemptNumber} — ${attempt.outcomeLabel ?? attempt.statusLabel}`} wrap minPresenceAhead={64}>
      <PdfKeyValueSection
        items={[
          { label: 'Status', value: attempt.statusLabel },
          { label: 'Outcome', value: attempt.outcomeLabel },
          { label: 'Form Version', value: attempt.formVersionNumber },
          { label: 'Started By', value: attempt.startedByName },
          { label: 'Started At', value: attempt.startedAt },
          { label: 'Finalized By', value: attempt.finalizedByName },
          { label: 'Finalized At', value: attempt.finalizedAt },
        ]}
        columns={4}
      />
      {attempt.outcomeLabel ? <Text style={styles.outcomeText}>{formatPdfValue(attempt.outcomeLabel)}</Text> : null}
      {attempt.rejectionReason ? <Text>{`Rejection / Defect Reason: ${attempt.rejectionReason}`}</Text> : null}
      {attempt.remarks ? <Text>{`Outcome remarks: ${attempt.remarks}`}</Text> : null}
      <QualityBlocksRenderer sections={attempt.sections} />
    </PdfSection>
  );
}

function BatchSection({ batch }: { batch: ConsolidatedFinalInspectionBatchViewModel }) {
  return (
    <PdfSection title={`Physical Batch ${batch.batchNumber}${batch.isCancelled ? ' (Cancelled)' : ''}`} wrap>
      {batch.isCancelled ? (
        <Text style={styles.cancelledBanner}>
          {`This physical batch was cancelled${batch.terminalByName ? ` by ${batch.terminalByName}` : ''}${
            batch.terminalAt ? ` on ${batch.terminalAt}` : ''
          }${batch.terminalReason ? ` — ${batch.terminalReason}` : ''}. It contributes zero active physical or released quantity.`}
        </Text>
      ) : null}
      <Text style={styles.note}>
        The size allocation and physical quantity below belong to this one physical batch and are
        counted exactly once, regardless of how many inspection attempts were recorded against it.
      </Text>
      <PdfKeyValueSection
        items={[
          { label: 'Physical Quantity', value: batch.physicalQuantity },
          { label: 'Disposition', value: batch.dispositionLabel },
          { label: 'Created', value: batch.createdAt },
          { label: 'Created By', value: batch.createdByName },
        ]}
        columns={4}
      />
      {batch.allocations.length > 0 ? (
        <PdfTable columns={allocationColumns} rows={batch.allocations} rowKey={(row) => row.jobOrderLineSizeId} />
      ) : null}
      {batch.releasedQuantity !== null ? (
        <Text style={styles.releaseBanner}>
          {`${batch.releasedQuantity} units released downstream${batch.releasedAt ? ` on ${batch.releasedAt}` : ''}.`}
        </Text>
      ) : null}
      <Text style={[styles.attemptHeading, { marginTop: 10 }]}>Inspection Attempts</Text>
      {batch.attempts.length === 0 ? (
        <Text style={styles.note}>No inspection attempts recorded against this batch.</Text>
      ) : (
        batch.attempts.map((attempt) => <AttemptSection key={attempt.id} attempt={attempt} />)
      )}
    </PdfSection>
  );
}

export interface ConsolidatedFinalInspectionDocumentProps {
  viewModel: ConsolidatedFinalInspectionPdfViewModel;
}

/**
 * Landscape, same shared PDF primitives/typography as the single-execution Final Inspection PDF
 * (`QualityExecutionDocument`) — Section A (summary), one Section per physical batch (each
 * containing one sub-section per recorded attempt, rendered via the same `QualityBlocksRenderer`
 * the single-execution PDF uses, never a rebuilt questionnaire), and a closing Section D
 * reconciliation sourced only from the server's own `coverage` fields.
 */
export function ConsolidatedFinalInspectionDocument({ viewModel }: ConsolidatedFinalInspectionDocumentProps) {
  const { reconciliation } = viewModel;
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Job Order &amp; Final Inspection Summary">
        <View style={styles.identityRow}>
          <View style={styles.imageWrapper}>
            <PdfThumbnail image={viewModel.image} width={90} height={90} />
          </View>
          <View style={styles.identityContent}>
            <PdfKeyValueSection items={viewModel.headerItems} columns={4} />
          </View>
        </View>
      </PdfSection>

      <PdfSection title="Physical Batch Summary" wrap>
        <PdfTable columns={summaryColumns} rows={viewModel.summaryRows} rowKey={(row) => String(row.batchNumber)} />
      </PdfSection>

      {viewModel.batches.map((batch) => (
        <BatchSection key={batch.id} batch={batch} />
      ))}

      <PdfSection title="Overall Reconciliation" wrap>
        <Text style={styles.note}>
          Figures below come directly from the Job Order&apos;s own authoritative physical-coverage
          projection, never recomputed by summing inspection attempts — a batch inspected across
          multiple attempts is still one physical quantity.
        </Text>
        <PdfKeyValueSection
          items={[
            { label: 'Prepared Quantity', value: reconciliation.preparedQuantity },
            { label: 'Active Physical Quantity (Reserved for Final QA)', value: reconciliation.activePhysicalQuantity },
            { label: 'Inspected Physical Quantity', value: reconciliation.inspectedPhysicalQuantity },
            { label: 'Resolved Physical Quantity', value: reconciliation.resolvedPhysicalQuantity },
            { label: 'Released Quantity', value: reconciliation.releasedQuantity },
            { label: 'Permanently Rejected Quantity', value: reconciliation.permanentlyRejectedQuantity },
            { label: 'Awaiting Reinspection Quantity', value: reconciliation.awaitingReinspectionQuantity },
            { label: 'Remaining / Available Quantity', value: reconciliation.remainingQuantity },
            { label: 'Coverage State', value: reconciliation.state },
            {
              label: 'Final QA Complete (as reported by the server)',
              value: reconciliation.finalQaComplete === null ? 'Unavailable' : reconciliation.finalQaComplete ? 'Yes' : 'No',
            },
            { label: 'Active Physical Batches', value: reconciliation.activeBatchCount },
            { label: 'Physical Batches (Incl. Cancelled)', value: reconciliation.totalBatchCount },
            {
              label: 'Total Recorded Inspection Attempts (Incl. Cancelled/Draft Batches)',
              value: reconciliation.totalAttemptCount,
            },
          ]}
          columns={3}
        />
        {reconciliation.reconciliationConflict ? (
          <Text style={styles.cancelledBanner}>
            The Job Order&apos;s own reconciliation reports a conflict between prepared and reserved
            physical quantities — investigate before treating this report as final.
          </Text>
        ) : null}
      </PdfSection>

      <PdfFooter />
    </PdfDocument>
  );
}
