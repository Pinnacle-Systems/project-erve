import { StyleSheet, Text, View } from '@react-pdf/renderer';
import { JobOrderQuantityMatrix } from './JobOrderQuantityMatrix.js';
import { PdfDocument } from '../../../lib/pdf/core/PdfDocument.js';
import { PdfHeader } from '../../../lib/pdf/core/PdfHeader.js';
import { PdfFooter } from '../../../lib/pdf/core/PdfFooter.js';
import { PdfMetaSection } from '../../../lib/pdf/core/PdfMetaSection.js';
import { PdfSection } from '../../../lib/pdf/core/PdfSection.js';
import { PdfKeyValueSection } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import { PdfThumbnail } from '../../../lib/pdf/core/PdfThumbnail.js';
import { PdfTable, type PdfTableColumn } from '../../../lib/pdf/core/PdfTable.js';
import type {
  JobOrderDetailPdfViewModel,
  JobOrderDetailQualityActivityRow,
  JobOrderDetailSourceOrderSheetRow,
  JobOrderDetailStageRow,
} from './buildJobOrderDetailViewModel.js';

const styles = StyleSheet.create({
  identityRow: { flexDirection: 'row', alignItems: 'flex-start' },
  imageWrapper: { marginRight: 16 },
  identityContent: { flex: 1 },
  note: { fontSize: 8, color: '#777777', marginBottom: 6 },
  totalsLine: { fontSize: 9, fontWeight: 700, color: '#111111', marginBottom: 4 },
  subheading: { fontSize: 8, fontWeight: 700, color: '#333333', marginTop: 8, marginBottom: 4 },
});

const sourceOrderSheetColumns: PdfTableColumn<JobOrderDetailSourceOrderSheetRow>[] = [
  { key: 'poNumber', header: 'Order Sheet No.', width: '20%', value: (row) => row.poNumber },
  {
    key: 'distributorName',
    header: 'Distributor',
    width: '35%',
    value: (row) => row.distributorName,
  },
  { key: 'purchaseMode', header: 'Mode', width: '15%', value: (row) => row.purchaseMode },
  {
    key: 'requiredDeliveryDate',
    header: 'Required Date',
    width: '15%',
    value: (row) => row.requiredDeliveryDate,
  },
  {
    key: 'forecastTotal',
    header: 'Forecast Qty',
    width: '15%',
    align: 'right',
    value: (row) => row.forecastTotal,
  },
];

const stageColumns: PdfTableColumn<JobOrderDetailStageRow>[] = [
  { key: 'sequence', header: 'Seq', width: '8%', align: 'right', value: (row) => row.sequence },
  { key: 'stageName', header: 'Stage', width: '32%', value: (row) => row.stageName },
  { key: 'status', header: 'Status', width: '20%', value: (row) => row.status },
  {
    key: 'completedByName',
    header: 'Completed By',
    width: '25%',
    value: (row) => row.completedByName,
  },
  { key: 'completedAt', header: 'Completed At', width: '15%', value: (row) => row.completedAt },
];

const qualityActivityColumns: PdfTableColumn<JobOrderDetailQualityActivityRow>[] = [
  { key: 'sequence', header: 'Seq', width: '5%', align: 'right', value: (row) => row.sequence },
  { key: 'name', header: 'Activity', width: '15%', value: (row) => row.name },
  { key: 'formDisplay', header: 'Form', width: '13%', value: (row) => row.formDisplay },
  { key: 'mode', header: 'Mode', width: '11%', value: (row) => row.mode },
  { key: 'status', header: 'Status', width: '11%', value: (row) => row.status },
  {
    key: 'gateRequirement',
    header: 'Gate Requirement',
    width: '15%',
    value: (row) => row.gateRequirement,
  },
  { key: 'outcome', header: 'Outcome', width: '8%', value: (row) => row.outcome },
  { key: 'coverageSummary', header: 'Coverage', width: '22%', value: (row) => row.coverageSummary },
];

export interface JobOrderDetailDocumentProps {
  viewModel: JobOrderDetailPdfViewModel;
}

/** Landscape — the source-Order-Sheet, quantity-matrix and quality-activity tables all read best wide. */
export function JobOrderDetailDocument({ viewModel }: JobOrderDetailDocumentProps) {
  return (
    <PdfDocument orientation="landscape">
      <PdfHeader title={viewModel.title} subtitle={viewModel.subtitle} />
      <PdfMetaSection generatedAt={viewModel.generatedAt} generatedBy={viewModel.generatedBy} />

      <PdfSection title="Job Order Details">
        <View style={styles.identityRow}>
          <View style={styles.imageWrapper}>
            <PdfThumbnail image={viewModel.image} width={90} height={90} />
          </View>
          <View style={styles.identityContent}>
            <PdfKeyValueSection items={viewModel.identityItems} columns={4} />
          </View>
        </View>
      </PdfSection>

      {viewModel.sourceOrderSheets ? (
        <PdfSection title="Source Order Sheets" wrap>
          <Text style={styles.note}>
            Merchandising planning provenance, informational only — not a strict allocation of Job
            Order output to any individual Order Sheet.
          </Text>
          <PdfTable
            columns={sourceOrderSheetColumns}
            rows={viewModel.sourceOrderSheets}
            rowKey={(row) => row.id}
          />
          {viewModel.combinedForecast.length > 0 ? (
            <>
              <Text style={styles.subheading}>Combined Forecast vs Job Order</Text>
              <JobOrderQuantityMatrix
                sizes={viewModel.combinedForecast.map((row) => ({
                  id: row.sizeId,
                  label: row.sizeLabel,
                }))}
                measures={[
                  {
                    label: 'Combined Forecast',
                    values: viewModel.combinedForecast.map((row) => row.forecastQuantity),
                  },
                  {
                    label: 'Production Plan',
                    values: viewModel.combinedForecast.map((row) => row.jobOrderQuantity),
                  },
                ]}
              />
            </>
          ) : null}
        </PdfSection>
      ) : null}

      <PdfSection title="Size-wise Quantities" wrap>
        <Text style={styles.totalsLine}>
          {viewModel.styleNumber} {viewModel.styleName}
        </Text>
        <Text style={[styles.note, { marginBottom: 4 }]}>{viewModel.quantityTotalsLine}</Text>
        <JobOrderQuantityMatrix
          sizes={viewModel.sizes.map((row) => ({ id: row.id, label: row.sizeCode }))}
          measures={[
            { label: 'Production Plan', values: viewModel.sizes.map((row) => row.orderedQuantity) },
            { label: 'Prepared', values: viewModel.sizes.map((row) => row.preparedQuantity) },
          ]}
        />
      </PdfSection>

      {viewModel.stages.length > 0 ? (
        <PdfSection title="Production Stages" wrap>
          <PdfTable columns={stageColumns} rows={viewModel.stages} rowKey={(row) => row.id} />
        </PdfSection>
      ) : null}

      {viewModel.qualityActivities.length > 0 ? (
        <PdfSection title="Quality Activities" wrap>
          <Text style={styles.note}>
            Operational summary only — PP Sample and PPM are independent gates (no sequential
            dependency implied by row order), and Inline/Final QA outcomes shown here do not replace
            the full inspection record.
          </Text>
          <PdfTable
            columns={qualityActivityColumns}
            rows={viewModel.qualityActivities}
            rowKey={(row) => row.id}
          />
        </PdfSection>
      ) : null}

      <PdfFooter />
    </PdfDocument>
  );
}
