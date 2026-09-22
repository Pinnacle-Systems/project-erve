import { QA_CHECKLIST_ITEMS, type QaEvidenceMetadata } from '@erve/types';
import { formatPdfDateTime } from '../../../../lib/pdf/format.js';
import type { PdfKeyValueItem } from '../../../../lib/pdf/core/PdfKeyValueSection.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';
import { IMAGE_CONTENT_TYPES } from '../shared/qualityResponseBlocks.js';
import { REWORK_STATUS_LABELS } from '../../../job-orders/job-order-ui.js';
import type { PreparedPpSamplePdfData } from './preparePpSamplePdfData.js';

export interface PpSamplePdfMeta {
  generatedAt: string;
  generatedBy?: string | null;
}

export interface PpSampleEvidenceItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  image: PdfImageSource | null;
}

export interface PpSampleChecklistRow {
  label: string;
  status: string;
  remarks: string | null;
}

export interface PpSampleFormRow {
  id: string;
  sizeLabel: string;
  styleNumber: string;
  sampleQuantity: number | null;
  decisionLabel: string;
  statusLabel: string;
  checklist: PpSampleChecklistRow[];
  inspectionRemarks: string | null;
  evidence: PpSampleEvidenceItem[];
}

export interface PpSampleSessionRow {
  id: string;
  cycleLabel: string;
  inspectorName: string;
  statusLabel: string;
  finalizedLabel: string | null;
  forms: PpSampleFormRow[];
  sessionEvidence: PpSampleEvidenceItem[];
}

export interface PpSampleReworkRow {
  id: string;
  styleNumber: string;
  sizeCode: string;
  quantity: number;
  attemptNumber: number;
  statusLabel: string;
}

export interface PpSamplePdfViewModel {
  title: string;
  subtitle: string;
  generatedAt: string;
  generatedBy?: string | null;
  headerItems: PdfKeyValueItem[];
  sessions: PpSampleSessionRow[];
  reworkTasks: PpSampleReworkRow[];
  downstreamAvailabilityText: string;
}

function evidenceItem(evidence: QaEvidenceMetadata, images: Map<string, PdfImageSource>): PpSampleEvidenceItem {
  const isImage = IMAGE_CONTENT_TYPES.has(evidence.contentType);
  return {
    id: evidence.id,
    fileName: evidence.fileName,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    isImage,
    image: isImage ? (images.get(evidence.id) ?? { placeholder: true }) : null,
  };
}

function checklistLabel(itemCode: string): string {
  return QA_CHECKLIST_ITEMS.find((definition) => definition.code === itemCode)?.label ?? itemCode.replaceAll('_', ' ');
}

/**
 * Pure, synchronous, no HTTP — maps the already-loaded `QaInspectionDetail` (the `/qa/:id` PP
 * Sample screen — every one of its route occurrences in the live app has a `processFlowPpSample`
 * session; the screen also carries a legacy generic-QA branch this view model does not need to
 * reproduce, since it's dead under current routing) plus pre-resolved evidence images into the
 * printable view model. PP Sample evidence is mandatory under the current implementation, so every
 * form always prints an Evidence section even when empty (never omitted).
 */
export function buildPpSampleViewModel(
  prepared: PreparedPpSamplePdfData,
  meta: PpSamplePdfMeta,
): PpSamplePdfViewModel {
  const { detail, evidenceImages } = prepared;

  const headerItems: PdfKeyValueItem[] = [
    { label: 'Job Order Number', value: detail.jobOrderNumber },
    { label: 'Factory', value: detail.factory.name },
    {
      label: 'Season Snapshot',
      value: detail.seasons.map((season) => season.displayName).join(', ') || null,
    },
  ];

  const sessions: PpSampleSessionRow[] = detail.sessions.map((session) => {
    const sessionEvidence = session.evidence
      .filter((evidence) => !evidence.inspectionLineId)
      .map((evidence) => evidenceItem(evidence, evidenceImages));

    const forms: PpSampleFormRow[] = session.forms.map((form) => ({
      id: form.id,
      sizeLabel: form.sizeLabel,
      styleNumber: form.styleNumber,
      sampleQuantity: session.processFlowPpSample?.sampleQuantity ?? form.sampleQuantity,
      decisionLabel: session.processFlowPpSample ? (session.processFlowPpSample.decision ?? 'Pending') : '—',
      statusLabel: form.status,
      checklist: form.checklist.map((item) => ({
        label: checklistLabel(item.itemCode),
        status: item.status ?? '—',
        remarks: item.remarks,
      })),
      inspectionRemarks: form.inspectionRemarks,
      evidence: session.evidence
        .filter((evidence) => evidence.inspectionLineId === form.id)
        .map((evidence) => evidenceItem(evidence, evidenceImages)),
    }));

    return {
      id: session.id,
      cycleLabel: `Cycle ${session.cycleNumber}${session.cycleNumber > 1 ? ' · Reinspection' : ''}`,
      inspectorName: session.inspector.name,
      statusLabel: session.status,
      finalizedLabel: session.finalizedAt ? formatPdfDateTime(session.finalizedAt) : null,
      forms,
      sessionEvidence,
    };
  });

  const reworkTasks: PpSampleReworkRow[] = detail.reworkTasks.map((task) => ({
    id: task.id,
    styleNumber: task.styleNumber,
    sizeCode: task.sizeCode,
    quantity: task.assignedQuantity,
    attemptNumber: task.attemptNumber,
    statusLabel: REWORK_STATUS_LABELS[task.status],
  }));

  return {
    title: 'PP SAMPLE CHECKLIST',
    subtitle: `${detail.jobOrderNumber} — ${detail.factory.name}`,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    headerItems,
    sessions,
    reworkTasks,
    downstreamAvailabilityText:
      detail.status === 'QA_APPROVED'
        ? `${detail.totals.finalApproved} units are authoritative for the future warehouse workflow.`
        : 'No quantity is downstream-ready until final QA approval.',
  };
}
