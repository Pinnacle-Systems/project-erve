import type { QualityExecutionPayload, QualityExecutionView } from '@erve/types';

/**
 * Shared fixture builder for QA execution PDF tests (prepare/build/document). Not itself a test —
 * every QA form component type the app currently supports is represented so block-builder and
 * document-render tests exercise the same shapes real forms produce.
 */
export function emptyQualityExecutionPayload(): QualityExecutionPayload {
  return {
    expectedVersion: 1,
    checklistResponses: [],
    aqlResults: [],
    defects: [],
    correctiveActions: [],
    testResults: [],
    quantities: [],
    comments: [],
    fieldResponses: [],
    attendees: [],
    actions: [],
    signoffs: [],
    outcome: null,
  };
}

export function makeQualityExecutionView(
  overrides: Partial<QualityExecutionView> = {},
): QualityExecutionView {
  const responses: QualityExecutionPayload = {
    expectedVersion: 3,
    checklistResponses: [{ componentId: 'checklist-1', itemKey: 'trims', response: 'YES', remarks: 'Checked' }],
    aqlResults: [{ componentId: 'aql-1', severity: 'MAJOR', maxAllowed: 5, found: 2 }],
    defects: [{ componentId: 'defects-1', description: 'Broken stitch', severity: 'MAJOR', quantity: 3 }],
    correctiveActions: [{ componentId: 'corrective-1', values: { action: 'Re-stitch panel' } }],
    testResults: [{ componentId: 'tests-1', testKey: 'wash', response: 'PASSED' }],
    quantities: [{ componentId: 'quantity-1', fieldKey: 'inspectedQty', value: 100 }],
    comments: [{ componentId: 'comments-1', value: 'All good' }],
    fieldResponses: [
      { componentId: 'fields-1', fieldKey: 'meetingDate', value: '2026-01-15' },
      { componentId: 'fields-1', fieldKey: 'isReady', value: 'true' },
    ],
    attendees: [{ componentId: 'attendees-1', roleKey: 'MERCHANDISER', attendeeName: 'Alice Merchant' }],
    actions: [{ componentId: 'actions-1', values: { action: 'Fix seam', dueDate: '2026-02-01' } }],
    signoffs: [{ componentId: 'signatures-1', roleKey: 'qa', signatoryName: 'Bob QA' }],
    outcome: { componentId: 'outcome-1', value: 'PASS', remarks: 'Looks good', rejectionReason: null },
  };

  return {
    id: 'execution-1',
    jobOrderId: 'jo-1',
    jobOrderNumber: 'JO-1001',
    processFlowActivityId: 'activity-1',
    activityName: 'INLINE QC',
    qualityForm: { id: 'form-1', code: 'INLINE', name: 'Inline QC Form', versionId: 'version-1', versionNumber: 2 },
    attemptNumber: 1,
    batchNumber: 1,
    inspectedQuantity: 100,
    status: 'FINALIZED',
    version: 3,
    startedAt: '2026-01-10T09:00:00Z',
    finalizedAt: '2026-01-10T11:00:00Z',
    ppSample: null,
    finalBatch: null,
    productionContext: {
      associatedActivity: { id: 'prod-1', code: 'CUT', name: 'Cutting' },
      stages: [{ id: 'stage-1', code: 'CUT', name: 'Cutting', status: 'COMPLETED', relationship: 'PREVIOUS' }],
    },
    coverage: {
      preparedQuantityAuthoritative: true,
      preparedQuantity: 200,
      inspectedQuantity: 100,
      remainingQuantity: 100,
      complete: false,
      reconciliationConflict: false,
      state: 'IN_PROGRESS',
      passedBatches: 1,
      failedBatches: 0,
      hasFailedBatches: false,
      batches: [],
    },
    sections: [
      {
        id: 'section-1',
        sequence: 1,
        title: 'Context',
        description: 'Job order and production context',
        components: [
          {
            id: 'system-1',
            sequence: 1,
            type: 'SYSTEM_CONTEXT',
            title: 'System Context',
            config: { fields: [{ key: 'jobOrderNumber', label: 'Job Order Number' }] },
            systemValue: [{ key: 'jobOrderNumber', value: 'JO-1001', available: true }],
          },
          {
            id: 'production-1',
            sequence: 2,
            type: 'PRODUCTION_PROGRESS',
            title: 'Production Context',
            config: { metrics: [{ sourceActivityCode: 'CUT' }] },
          },
        ],
      },
      {
        id: 'section-2',
        sequence: 2,
        title: 'Inspection',
        components: [
          {
            id: 'fields-1',
            sequence: 1,
            type: 'FIELD_GROUP',
            title: 'Details',
            config: {
              fields: [
                { key: 'meetingDate', label: 'Meeting Date', dataType: 'DATE', source: 'RESPONSE' },
                { key: 'isReady', label: 'Ready', dataType: 'BOOLEAN', source: 'RESPONSE' },
              ],
            },
          },
          {
            id: 'attendees-1',
            sequence: 2,
            type: 'ATTENDEE_LIST',
            title: 'Attendees',
            config: { roles: ['MERCHANDISER', 'QA_USER'] },
          },
          {
            id: 'actions-1',
            sequence: 3,
            type: 'ACTION_LIST',
            title: 'Follow-up Actions',
            config: {
              columns: [
                { key: 'action', label: 'Action', dataType: 'TEXT' },
                { key: 'dueDate', label: 'Due Date', dataType: 'DATE' },
              ],
            },
          },
          {
            id: 'checklist-1',
            sequence: 4,
            type: 'CHECKLIST',
            title: 'Checklist',
            config: {
              items: [{ key: 'trims', label: 'Trims card confirmed' }],
              responseOptions: ['YES', 'NO'],
            },
          },
          {
            id: 'aql-1',
            sequence: 5,
            type: 'AQL_RESULT',
            title: 'AQL Results',
            config: { criteria: [{ severity: 'MAJOR', aql: 2.5 }] },
          },
          {
            id: 'defects-1',
            sequence: 6,
            type: 'DEFECT_LIST',
            title: 'Defects',
            config: { severities: ['CRITICAL', 'MAJOR', 'MINOR'], captureQuantity: true },
          },
          {
            id: 'corrective-1',
            sequence: 7,
            type: 'CORRECTIVE_ACTIONS',
            title: 'Corrective Actions',
            config: { columns: [{ key: 'action', label: 'Corrective Action' }] },
          },
          {
            id: 'tests-1',
            sequence: 8,
            type: 'TEST_RESULTS',
            title: 'Test Results',
            config: { tests: [{ key: 'wash', label: 'Wash Test', responseOptions: ['PASSED', 'FAILED'] }] },
          },
          {
            id: 'quantity-1',
            sequence: 9,
            type: 'QUANTITY_RECONCILIATION',
            title: 'Quantity Reconciliation',
            config: { fields: [{ key: 'inspectedQty', label: 'Inspected Qty', source: 'RESPONSE' }] },
          },
          {
            id: 'comments-1',
            sequence: 10,
            type: 'COMMENTS',
            title: 'Comments',
            config: { required: true },
          },
          {
            id: 'signatures-1',
            sequence: 11,
            type: 'SIGNATURES',
            title: 'Signatures',
            config: { roles: [{ key: 'qa', label: 'QA Signatory' }] },
          },
          {
            id: 'attachments-1',
            sequence: 12,
            type: 'ATTACHMENTS',
            title: 'Evidence',
            config: { requirements: [{ key: 'photo', label: 'Defect Photo', required: true }] },
          },
          {
            id: 'outcome-1',
            sequence: 13,
            type: 'INSPECTION_OUTCOME',
            title: 'Inspection Outcome',
            config: { allowedOutcomes: ['PASS', 'FAIL'] },
          },
        ],
      },
    ],
    responses,
    attachments: [
      {
        id: 'attachment-1',
        componentId: 'attachments-1',
        requirementKey: 'photo',
        fileName: 'defect.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 12345,
        createdAt: '2026-01-10T10:30:00Z',
      },
    ],
    ...overrides,
  };
}

/** A PPM-shaped fixture: no INSPECTION_OUTCOME component anywhere, and no outcome response — this is
 * how the canonical PPM form is bootstrapped (see quality-bootstrap-definitions.ts). */
export function makePpmQualityExecutionView(
  overrides: Partial<QualityExecutionView> = {},
): QualityExecutionView {
  const base = makeQualityExecutionView(overrides);
  return {
    ...base,
    activityName: 'PPM',
    qualityForm: { ...base.qualityForm, code: 'PPM', name: 'PPM Form' },
    sections: base.sections.map((section) => ({
      ...section,
      components: section.components.filter((component) => component.type !== 'INSPECTION_OUTCOME'),
    })),
    responses: { ...base.responses, outcome: null },
  };
}
