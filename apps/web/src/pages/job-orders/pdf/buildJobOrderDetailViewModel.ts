import { formatPdfDate, formatPdfDateTime, formatPdfMoney } from '../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../lib/pdf/core/PdfKeyValueSection.js';
import {
  CONFIRMATION_LABELS,
  JOB_ORDER_STATUS_LABELS,
  QUALITY_RUNTIME_STATUS_LABELS,
  STAGE_LABELS,
} from '../job-order-ui.js';
import type { JobOrder } from '../types.js';
import type { PurchaseMode } from '../../purchase-orders/types.js';

const PURCHASE_MODE_LABELS: Record<PurchaseMode, string> = {
  OUTRIGHT: 'Outright',
  SALE_RETURN: 'Sale or Return',
};

const GATE_REQUIREMENT_LABELS: Record<'FINALIZED' | 'OUTCOME_PASS', string> = {
  FINALIZED: 'Finalized (no pass/fail outcome)',
  OUTCOME_PASS: 'Pass required to proceed',
};

export interface JobOrderDetailPdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface JobOrderDetailSourceOrderSheetRow {
  id: string;
  poNumber: string;
  distributorName: string;
  purchaseMode: string;
  requiredDeliveryDate: string;
  forecastTotal: number;
}

export interface JobOrderDetailCombinedForecastRow {
  sizeId: string;
  sizeLabel: string;
  forecastQuantity: number;
  jobOrderQuantity: number;
  varianceQuantity: number;
}

export interface JobOrderDetailSizeRow {
  id: string;
  sizeCode: string;
  orderedQuantity: number;
  preparedQuantity: number;
  varianceQuantity: number;
}

export interface JobOrderDetailStageRow {
  id: string;
  sequence: number;
  stageName: string;
  status: string;
  completedByName: string;
  completedAt: string;
}

export interface JobOrderDetailQualityActivityRow {
  id: string;
  sequence: number;
  name: string;
  formDisplay: string;
  mode: string;
  status: string;
  gateRequirement: string;
  outcome: string | number | null;
  coverageSummary: string;
}

export interface JobOrderDetailPdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  identityItems: PdfKeyValueItem[];
  styleNumber: string;
  styleName: string;
  quantityTotalsLine: string;
  sizes: JobOrderDetailSizeRow[];
  sourceOrderSheets: JobOrderDetailSourceOrderSheetRow[] | null;
  combinedForecast: JobOrderDetailCombinedForecastRow[];
  stages: JobOrderDetailStageRow[];
  qualityActivities: JobOrderDetailQualityActivityRow[];
}

function coverageSummary(coverage: JobOrder['qualityActivities'][number]['coverage']): string {
  if (!coverage) return '';
  const prepared = coverage.preparedQuantityAuthoritative ? coverage.preparedQuantity : null;
  const inspected = coverage.inspectedPhysicalCoverage ?? coverage.inspectedQuantity;
  const parts = [
    `Prepared ${prepared ?? 'pending'}`,
    `Inspected ${inspected}`,
    `Passed ${coverage.passedBatches}`,
    `Failed ${coverage.failedBatches}`,
  ];
  return parts.join(' · ');
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded Job Order detail query data + meta into the
 * plain view-model JobOrderDetailDocument renders. This is a field-by-field allowlist, never
 * `...jobOrder` — a fixture or future API field the caller wasn't expecting cannot silently reach
 * the printed document.
 *
 * The persisted `jobOrder.status` (JOB_ORDER_STATUS_LABELS) is printed as the authoritative
 * lifecycle — never re-derived here. PP Sample and PPM are two independent rows in
 * `qualityActivities`, listed in their process-flow sequence with no drawn dependency between them;
 * PPM's `outcome` is printed exactly as persisted (null unless the current domain sets one — this
 * view model never infers a synthetic PASS/FAIL). Inline/Final QA rows are a coverage summary only,
 * not the full inspection form (that belongs to a later QA PDF phase). sourceOrderSheets/
 * combinedForecast are Merchandising-planning provenance, informational only — never presented as
 * strict allocation, and `null` (not an empty array) when the current viewer's record omits them
 * entirely (Factory/QA viewers), so the document can render "not available for this viewer" rather
 * than a misleading empty section.
 */
export function buildJobOrderDetailViewModel(
  jobOrder: JobOrder,
  meta: JobOrderDetailPdfMeta,
): JobOrderDetailPdfViewModel {
  const line = jobOrder.lines[0];
  const variance = jobOrder.preparedQuantityTotal - jobOrder.orderedQuantityTotal;

  const identityItems: PdfKeyValueItem[] = [
    { label: 'Job Order Number', value: jobOrder.jobOrderNumber },
    { label: 'Style Number', value: line?.styleNumber ?? null },
    { label: 'Style Name', value: line?.styleName ?? null },
    { label: 'Factory', value: jobOrder.factory.name },
    { label: 'Lifecycle Status', value: JOB_ORDER_STATUS_LABELS[jobOrder.status] },
    {
      label: 'Process Flow',
      value: `${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`,
    },
    { label: 'Factory Unit Price', value: formatPdfMoney(jobOrder.unitPrice, 'INR') },
    { label: 'Source Order Sheets', value: jobOrder.sourceOrderSheetCount },
    {
      label: 'Required Delivery Date',
      value: jobOrder.requiredDeliveryDate
        ? `${formatPdfDate(jobOrder.requiredDeliveryDate)}${jobOrder.isDelayed ? ' (Delayed)' : ''}`
        : null,
    },
    { label: 'Delivery Date Locked', value: jobOrder.deliveryDateLocked ? 'Yes' : 'No' },
    { label: 'Factory Confirmation', value: CONFIRMATION_LABELS[jobOrder.factoryConfirmationStatus] },
    { label: 'Confirmed By', value: jobOrder.confirmedBy?.name ?? null },
    { label: 'Confirmed At', value: formatPdfDateTime(jobOrder.confirmedAt) },
    { label: 'Ordered Quantity', value: jobOrder.orderedQuantityTotal },
    { label: 'Prepared Quantity', value: jobOrder.preparedQuantityTotal },
    { label: 'Variance', value: variance },
    { label: 'Production Started', value: formatPdfDateTime(jobOrder.productionStartedAt) },
    { label: 'Production Completed', value: formatPdfDateTime(jobOrder.productionCompletedAt) },
    { label: 'Created', value: formatPdfDateTime(jobOrder.createdAt) },
    { label: 'Created By', value: jobOrder.creator.name },
  ];

  const sizes: JobOrderDetailSizeRow[] = (line?.sizes ?? []).map((size) => ({
    id: size.id,
    sizeCode: size.sizeCode,
    orderedQuantity: size.orderedQuantity,
    preparedQuantity: size.preparedQuantity,
    varianceQuantity: size.varianceQuantity,
  }));

  const sourceOrderSheets: JobOrderDetailSourceOrderSheetRow[] | null = jobOrder.sourceOrderSheets
    ? jobOrder.sourceOrderSheets.map((os) => ({
        id: os.id,
        poNumber: os.poNumber,
        distributorName: os.distributor.name,
        purchaseMode: PURCHASE_MODE_LABELS[os.purchaseMode],
        requiredDeliveryDate: os.requiredDeliveryDate ? formatPdfDate(os.requiredDeliveryDate) : '',
        forecastTotal: os.forecastTotal,
      }))
    : null;

  const combinedForecast: JobOrderDetailCombinedForecastRow[] = (jobOrder.combinedForecast ?? []).map((row) => {
    const jobOrderQuantity = jobOrder.lines
      .flatMap((jobOrderLine) => jobOrderLine.sizes)
      .filter((size) => size.sizeId === row.sizeId)
      .reduce((sum, size) => sum + size.orderedQuantity, 0);
    return {
      sizeId: row.sizeId,
      sizeLabel: row.sizeLabel,
      forecastQuantity: row.forecastQuantity,
      jobOrderQuantity,
      varianceQuantity: jobOrderQuantity - row.forecastQuantity,
    };
  });

  const stages: JobOrderDetailStageRow[] = [...jobOrder.stages]
    .sort((a, b) => a.stageSequence - b.stageSequence)
    .map((stage) => ({
      id: stage.id,
      sequence: stage.stageSequence,
      stageName: stage.stageNameSnapshot,
      status: STAGE_LABELS[stage.status],
      completedByName: stage.completedBy?.name ?? '',
      completedAt: stage.completedAt ? formatPdfDateTime(stage.completedAt) : '',
    }));

  const qualityActivities: JobOrderDetailQualityActivityRow[] = [...jobOrder.qualityActivities]
    .sort((a, b) => a.sequence - b.sequence)
    .map((activity) => ({
      id: activity.processFlowVersionStageId,
      sequence: activity.sequence,
      name: activity.name,
      formDisplay: `${activity.qualityForm.name} v${activity.qualityFormVersion.versionNumber}`,
      mode: activity.executionMode === 'IN_PROCESS' ? 'In-process' : 'Sequential Gate',
      status: QUALITY_RUNTIME_STATUS_LABELS[activity.status],
      gateRequirement: activity.gateSatisfactionRequirement
        ? GATE_REQUIREMENT_LABELS[activity.gateSatisfactionRequirement]
        : '',
      outcome: activity.execution?.outcome ?? null,
      coverageSummary: coverageSummary(activity.coverage),
    }));

  return {
    title: 'JOB ORDER',
    subtitle: `${jobOrder.jobOrderNumber} — ${jobOrder.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    identityItems,
    styleNumber: line?.styleNumber ?? '',
    styleName: line?.styleName ?? '',
    quantityTotalsLine: `Ordered: ${jobOrder.orderedQuantityTotal}  Prepared: ${jobOrder.preparedQuantityTotal}  Variance: ${variance}`,
    sizes,
    sourceOrderSheets,
    combinedForecast,
    stages,
    qualityActivities,
  };
}
