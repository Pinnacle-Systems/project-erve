import { StyleSheet, Text } from '@react-pdf/renderer';
import { PdfDocument } from '../../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfTable, type PdfTableColumn } from '../../../../lib/pdf/core/PdfTable.js';
import { formatPdfValue } from '../../../../lib/pdf/format.js';
import { QualityBlocksRenderer } from '../shared/QualityBlocksRenderer.js';
import type {
  QualityExecutionPdfViewModel,
  QualityFinalBatchAllocationRow,
  QualityFinalBatchAttemptRow,
} from './buildQualityExecutionViewModel.js';

const styles = StyleSheet.create({
  outcomeValue: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  note: { fontSize: 8, color: '#777777', marginBottom: 6 },
  releaseBanner: { fontSize: 9, color: '#166534', marginTop: 6 },
});

const allocationColumns: PdfTableColumn<QualityFinalBatchAllocationRow>[] = [
  { key: 'label', header: 'Size', width: '60%', value: (row) => row.label },
  { key: 'quantity', header: 'Quantity', width: '40%', align: 'right', value: (row) => row.quantity },
];

const attemptColumns: PdfTableColumn<QualityFinalBatchAttemptRow>[] = [
  { key: 'attemptNumber', header: 'Attempt', width: '10%', align: 'right', value: (row) => row.attemptNumber },
  { key: 'statusLabel', header: 'Status', width: '15%', value: (row) => row.statusLabel },
  { key: 'outcome', header: 'Outcome', width: '12%', value: (row) => row.outcome },
  { key: 'rejectionReason', header: 'Rejection / Defect Reason', width: '33%', value: (row) => row.rejectionReason },
  { key: 'startedAt', header: 'Started', width: '15%', value: (row) => row.startedAt },
  { key: 'finalizedAt', header: 'Finalized', width: '15%', value: (row) => row.finalizedAt },
];

export interface QualityExecutionDocumentProps {
  viewModel: QualityExecutionPdfViewModel;
}

/**
 * Landscape — shared by PPM, Inline, and Final QA executions (one persisted model, one screen).
 * Outcome and Final-batch/disposition sections render only when the view model actually carries
 * them (see buildQualityExecutionViewModel) — nothing here infers a result the domain didn't record.
 */
export function QualityExecutionDocument({ viewModel }: QualityExecutionDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Execution Details">
        <PdfKeyValueSection items={viewModel.headerItems} columns={4} />
      </PdfSection>

      {viewModel.outcome ? (
        <PdfSection title="Outcome">
          <Text style={styles.outcomeValue}>{formatPdfValue(viewModel.outcome.value)}</Text>
          {viewModel.outcome.remarks ? (
            <Text>{`Outcome remarks: ${viewModel.outcome.remarks}`}</Text>
          ) : null}
          {viewModel.outcome.rejectionReason ? (
            <Text>{`Rejection / Defect Reason: ${viewModel.outcome.rejectionReason}`}</Text>
          ) : null}
        </PdfSection>
      ) : null}

      {viewModel.finalBatch ? (
        <PdfSection title={`Final QA Batch ${viewModel.finalBatch.batchNumber}`} wrap>
          <Text style={styles.note}>
            The size allocation belongs to this physical batch and stays unchanged across every
            inspection attempt against it.
          </Text>
          <PdfKeyValueSection
            items={[
              { label: 'Physical Quantity', value: viewModel.finalBatch.physicalQuantity },
              { label: 'Disposition', value: viewModel.finalBatch.dispositionLabel },
            ]}
            columns={4}
          />
          {viewModel.finalBatch.allocations.length > 0 ? (
            <PdfTable
              columns={allocationColumns}
              rows={viewModel.finalBatch.allocations}
              rowKey={(row) => row.jobOrderLineSizeId}
            />
          ) : null}
          <Text style={[styles.note, { marginTop: 8 }]}>Inspection Attempts</Text>
          {viewModel.finalBatch.attempts.length > 0 ? (
            <PdfTable columns={attemptColumns} rows={viewModel.finalBatch.attempts} rowKey={(row) => row.id} />
          ) : null}
          {viewModel.finalBatch.releasedQuantity !== null ? (
            <Text style={styles.releaseBanner}>
              {`${viewModel.finalBatch.releasedQuantity} units released downstream${
                viewModel.finalBatch.releasedAt ? ` on ${viewModel.finalBatch.releasedAt}` : ''
              }.`}
            </Text>
          ) : null}
        </PdfSection>
      ) : null}

      <QualityBlocksRenderer sections={viewModel.sections} />

      <PdfFooter />
    </PdfDocument>
  );
}
