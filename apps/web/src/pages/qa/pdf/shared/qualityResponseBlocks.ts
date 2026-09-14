import type { QualityExecutionPayload, QualityExecutionView } from '@erve/types';
import { formatPdfDate, formatPdfValue } from '../../../../lib/pdf/format.js';
import type { PdfImageSource } from '../../../../lib/pdf/core/PdfThumbnail.js';

type ConfigRow = Record<string, unknown>;

const rows = (value: unknown): ConfigRow[] => (Array.isArray(value) ? (value as ConfigRow[]) : []);
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/(^|[_\s-])\S/g, (character) => character.toUpperCase())
    .replaceAll('_', ' ');

export interface QualityPdfKeyValue {
  label: string;
  value: string | number | null | undefined;
}

export interface QualityPdfTableColumn {
  key: string;
  header: string;
  width: string;
  align?: 'left' | 'right' | 'center';
}

export interface QualityPdfEvidenceItem {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isImage: boolean;
  image: PdfImageSource | null;
}

export type QualityPdfBlock =
  | { kind: 'grid'; heading: string; description?: string | null; items: QualityPdfKeyValue[] }
  | {
      kind: 'checklist';
      heading: string;
      description?: string | null;
      rows: Array<{ label: string; result: string; remarks?: string | null }>;
    }
  | {
      kind: 'table';
      heading: string;
      description?: string | null;
      columns: QualityPdfTableColumn[];
      rows: Array<Record<string, string>>;
      emptyText: string;
    }
  | { kind: 'text'; heading: string; description?: string | null; value: string }
  | {
      kind: 'attachments';
      heading: string;
      description?: string | null;
      requirements: Array<{ label: string; required: boolean; items: QualityPdfEvidenceItem[] }>;
    };

export interface QualityPdfSection {
  id: string;
  title: string;
  description?: string | null;
  blocks: QualityPdfBlock[];
}

const IMAGE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function formatFieldValue(dataType: unknown, value: string): string {
  if (!value) return '';
  if (dataType === 'DATE') return formatPdfDate(value);
  if (dataType === 'BOOLEAN') return value === 'true' ? 'Yes' : 'No';
  return value;
}

function systemContextBlock(component: QualityExecutionView['sections'][number]['components'][number]): QualityPdfBlock {
  const config = component.config;
  const definitions = rows(config.fields ?? config.metrics);
  const items: QualityPdfKeyValue[] = (component.systemValue ?? []).map((item) => {
    const definition = definitions.find((row) => row.key === item.key);
    return {
      label: text(definition?.label ?? item.key),
      value: item.available ? text(item.value) : 'Unavailable',
    };
  });
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function productionProgressBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  productionContext: QualityExecutionView['productionContext'],
): QualityPdfBlock {
  const items: QualityPdfKeyValue[] = [];
  if (productionContext?.associatedActivity) {
    items.push({ label: 'Associated Production Activity', value: productionContext.associatedActivity.name });
  }
  for (const stage of productionContext?.stages ?? []) {
    items.push({ label: `${stage.name} (${titleCase(stage.relationship)})`, value: titleCase(stage.status) });
  }
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function fieldGroupBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const items: QualityPdfKeyValue[] = rows(config.fields).map((field) => {
    const fieldKey = text(field.key);
    if (field.source === 'SYSTEM') {
      const systemValue = component.systemValue?.find((value) => value.key === fieldKey);
      return { label: text(field.label), value: systemValue?.available ? text(systemValue.value) : 'Unavailable' };
    }
    const current = responses.fieldResponses.find(
      (value) => value.componentId === component.id && value.fieldKey === fieldKey,
    );
    return { label: text(field.label), value: formatFieldValue(field.dataType, current?.value ?? '') };
  });
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function attendeeListBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const items: QualityPdfKeyValue[] = (Array.isArray(config.roles) ? config.roles : []).map((role) => {
    const roleConfig = typeof role === 'string' ? null : (role as ConfigRow);
    const roleKey = typeof role === 'string' ? role : text(roleConfig?.key);
    const roleLabel = typeof role === 'string' ? role : text(roleConfig?.label ?? roleKey);
    const current = responses.attendees.find(
      (value) => value.componentId === component.id && value.roleKey === roleKey,
    );
    return { label: roleLabel, value: current?.attendeeName };
  });
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function actionListBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const columnDefs = rows(config.columns);
  const columns: QualityPdfTableColumn[] = columnDefs.map((column, index) => ({
    key: text(column.key),
    header: text(column.label),
    width: `${Math.floor(100 / Math.max(1, columnDefs.length))}%`,
    align: index === columnDefs.length - 1 ? 'left' : 'left',
  }));
  const actionRows = responses.actions
    .filter((action) => action.componentId === component.id)
    .map((action) => {
      const row: Record<string, string> = {};
      for (const column of columnDefs) {
        const columnKey = text(column.key);
        row[columnKey] = formatFieldValue(column.dataType, text(action.values[columnKey]));
      }
      return row;
    });
  return {
    kind: 'table',
    heading: component.title,
    description: component.description,
    columns,
    rows: actionRows,
    emptyText: 'No follow-up actions added.',
  };
}

function correctiveActionsBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const columnDefs = rows(config.columns);
  const columns: QualityPdfTableColumn[] = columnDefs.map((column) => ({
    key: text(column.key),
    header: text(column.label),
    width: `${Math.floor(100 / Math.max(1, columnDefs.length))}%`,
  }));
  const actionRows = responses.correctiveActions
    .filter((action) => action.componentId === component.id)
    .map((action) => {
      const row: Record<string, string> = {};
      for (const column of columnDefs) {
        const columnKey = text(column.key);
        row[columnKey] = text(action.values[columnKey]);
      }
      return row;
    });
  return {
    kind: 'table',
    heading: component.title,
    description: component.description,
    columns,
    rows: actionRows,
    emptyText: 'No corrective actions added.',
  };
}

function checklistBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const checklistRows = rows(config.items).map((item) => {
    const itemKey = text(item.key);
    const current = responses.checklistResponses.find(
      (value) => value.componentId === component.id && value.itemKey === itemKey,
    );
    return { label: text(item.label), result: current?.response ?? '—', remarks: current?.remarks ?? null };
  });
  return { kind: 'checklist', heading: component.title, description: component.description, rows: checklistRows };
}

function aqlResultBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const columns: QualityPdfTableColumn[] = [
    { key: 'classification', header: 'Classification', width: '30%' },
    { key: 'aql', header: 'AQL', width: '15%', align: 'right' },
    { key: 'maxAllowed', header: 'Max Allowed', width: '25%', align: 'right' },
    { key: 'found', header: 'Found', width: '30%', align: 'right' },
  ];
  const aqlRows = rows(config.criteria).map((criterion) => {
    const severity = text(criterion.severity);
    const current = responses.aqlResults.find(
      (value) => value.componentId === component.id && value.severity === severity,
    );
    return {
      classification: titleCase(severity),
      aql: text(criterion.aql),
      maxAllowed: formatPdfValue(current?.maxAllowed ?? null),
      found: formatPdfValue(current?.found ?? null),
    };
  });
  return {
    kind: 'table',
    heading: component.title,
    description: component.description,
    columns,
    rows: aqlRows,
    emptyText: 'No AQL criteria configured.',
  };
}

function defectListBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const captureQuantity = config.captureQuantity === true;
  const columns: QualityPdfTableColumn[] = [
    { key: 'description', header: 'Defect Description', width: captureQuantity ? '55%' : '70%' },
    { key: 'severity', header: 'Severity', width: captureQuantity ? '25%' : '30%' },
    ...(captureQuantity
      ? [{ key: 'quantity', header: 'Quantity', width: '20%', align: 'right' as const }]
      : []),
  ];
  const defectRows = responses.defects
    .filter((defect) => defect.componentId === component.id)
    .map((defect) => ({
      description: defect.description,
      severity: titleCase(defect.severity),
      ...(captureQuantity ? { quantity: formatPdfValue(defect.quantity ?? null) } : {}),
    }));
  return {
    kind: 'table',
    heading: component.title,
    description: component.description,
    columns,
    rows: defectRows,
    emptyText: 'No defects recorded.',
  };
}

function testResultsBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const testRows = rows(config.tests).map((testItem) => {
    const testKey = text(testItem.key);
    const current = responses.testResults.find(
      (value) => value.componentId === component.id && value.testKey === testKey,
    );
    return { label: text(testItem.label), result: current?.response ?? '—', remarks: current?.remarks ?? null };
  });
  return {
    kind: 'checklist',
    heading: component.title,
    description: component.description,
    rows: testRows,
  };
}

function quantityReconciliationBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  execution: QualityExecutionView,
): QualityPdfBlock {
  const config = component.config;
  const items: QualityPdfKeyValue[] = rows(config.fields).map((field) => {
    const fieldKey = text(field.key);
    if (field.source === 'SYSTEM') {
      const systemValue = component.systemValue?.find((value) => value.key === fieldKey);
      return { label: text(field.label), value: systemValue?.available ? text(systemValue.value) : 'Unavailable' };
    }
    const response = execution.responses.quantities.find(
      (value) => value.componentId === component.id && value.fieldKey === fieldKey,
    );
    return { label: text(field.label), value: response?.value ?? null };
  });
  if (execution.coverage) {
    const priorInspected = execution.coverage.batches
      .filter((batch) => batch.status === 'FINALIZED' && batch.batchNumber < execution.batchNumber)
      .reduce((sum, batch) => sum + (batch.inspectedQuantity ?? 0), 0);
    const remaining = execution.coverage.preparedQuantityAuthoritative
      ? Math.max(0, (execution.coverage.preparedQuantity ?? 0) - priorInspected - (execution.inspectedQuantity ?? 0))
      : null;
    items.push(
      {
        label: 'Prepared Quantity',
        value: execution.coverage.preparedQuantityAuthoritative ? execution.coverage.preparedQuantity : 'Unavailable',
      },
      { label: 'Previously Inspected', value: priorInspected },
      { label: 'This Inspection', value: execution.inspectedQuantity },
      { label: 'Remaining After This Batch', value: remaining ?? 'Pending prepared quantity' },
    );
  }
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function commentsBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const value = responses.comments.find((value) => value.componentId === component.id)?.value ?? '';
  return { kind: 'text', heading: component.title, description: component.description, value: value || '—' };
}

function signaturesBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  responses: QualityExecutionPayload,
): QualityPdfBlock {
  const config = component.config;
  const items: QualityPdfKeyValue[] = rows(config.roles).map((role) => {
    const roleKey = text(role.key);
    const current = responses.signoffs.find(
      (value) => value.componentId === component.id && value.roleKey === roleKey,
    );
    return { label: text(role.label), value: current?.signatoryName };
  });
  return { kind: 'grid', heading: component.title, description: component.description, items };
}

function attachmentsBlock(
  component: QualityExecutionView['sections'][number]['components'][number],
  execution: QualityExecutionView,
  evidenceImages: Map<string, PdfImageSource>,
): QualityPdfBlock {
  const config = component.config;
  const requirements = rows(config.requirements).map((requirement) => {
    const requirementKey = text(requirement.key);
    const required =
      requirement.required === true ||
      requirement.requiredWhen === 'ALWAYS' ||
      (requirement.requiredWhen === 'INSPECTION_FAILED' && execution.responses.outcome?.value === 'FAIL');
    const items: QualityPdfEvidenceItem[] = execution.attachments
      .filter((item) => item.componentId === component.id && item.requirementKey === requirementKey)
      .map((item) => {
        const isImage = IMAGE_CONTENT_TYPES.has(item.contentType);
        return {
          id: item.id,
          fileName: item.fileName,
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
          isImage,
          image: isImage ? (evidenceImages.get(item.id) ?? { placeholder: true }) : null,
        };
      });
    return { label: text(requirement.label), required, items };
  });
  return {
    kind: 'attachments',
    heading: component.title,
    description: component.description,
    requirements,
  };
}

/**
 * Builds generic printable blocks for every QA form component type, mirroring the finalized/
 * read-only render paths of `QualityExecutionForm` (the shared PPM/Inline/Final execution
 * renderer). `INSPECTION_OUTCOME` is deliberately excluded — outcome/disposition are printed as
 * their own explicit sections by the caller, never folded into this generic component list, so
 * STATUS/OUTCOME/DISPOSITION stay visually distinct per the QA PDF design rules.
 */
export function buildQualitySections(
  execution: QualityExecutionView,
  evidenceImages: Map<string, PdfImageSource>,
): QualityPdfSection[] {
  return [...execution.sections]
    .sort((a, b) => a.sequence - b.sequence)
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      blocks: [...section.components]
        .sort((a, b) => a.sequence - b.sequence)
        .filter((component) => component.type !== 'INSPECTION_OUTCOME')
        .map((component): QualityPdfBlock | null => {
          switch (component.type) {
            case 'SYSTEM_CONTEXT':
              return systemContextBlock(component);
            case 'PRODUCTION_PROGRESS':
              return productionProgressBlock(component, execution.productionContext);
            case 'FIELD_GROUP':
              return fieldGroupBlock(component, execution.responses);
            case 'ATTENDEE_LIST':
              return attendeeListBlock(component, execution.responses);
            case 'ACTION_LIST':
              return actionListBlock(component, execution.responses);
            case 'CHECKLIST':
              return checklistBlock(component, execution.responses);
            case 'AQL_RESULT':
              return aqlResultBlock(component, execution.responses);
            case 'DEFECT_LIST':
              return defectListBlock(component, execution.responses);
            case 'CORRECTIVE_ACTIONS':
              return correctiveActionsBlock(component, execution.responses);
            case 'TEST_RESULTS':
              return testResultsBlock(component, execution.responses);
            case 'QUANTITY_RECONCILIATION':
              return quantityReconciliationBlock(component, execution);
            case 'COMMENTS':
              return commentsBlock(component, execution.responses);
            case 'SIGNATURES':
              return signaturesBlock(component, execution.responses);
            case 'ATTACHMENTS':
              return attachmentsBlock(component, execution, evidenceImages);
            default:
              return null;
          }
        })
        .filter((block): block is QualityPdfBlock => block !== null),
    }));
}

export { IMAGE_CONTENT_TYPES };
