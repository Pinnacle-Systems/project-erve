import type { JobOrderStage } from '../types.js';

export type MockJobOrderStage = JobOrderStage;

export const stage = (
  id: string,
  name: string,
  sequence: number,
  status: JobOrderStage['status'],
): JobOrderStage => ({
  id,
  processFlowVersionStageId: `flow-${id}`,
  stageSequence: sequence,
  stageNameSnapshot: name,
  status,
  completedAt: status === 'COMPLETED' ? '2026-07-31T10:00:00Z' : null,
  completedBy: status === 'COMPLETED' ? { id: 'user-1', name: 'Alice', email: 'alice@test.local' } : null,
  remarks: null,
  createdAt: '2026-07-30T10:00:00Z',
  updatedAt: '2026-07-31T10:00:00Z',
});

export const standardStages = [
  stage('stage-1', 'Cutting', 1, 'NOT_STARTED'),
  stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
  stage('stage-3', 'Sewing', 3, 'NOT_STARTED'),
  stage('stage-4', 'Finishing', 4, 'NOT_STARTED'),
];

export const mockJobOrder = (
  status: string,
  stages: JobOrderStage[] = standardStages,
  overrides: Record<string, unknown> = {},
) => ({
  id: 'jo-1',
  jobOrderNumber: 'JO-001',
  status,
  operationalState: {
    lifecycleContext: {
      code: status,
      label: status.replaceAll('_', ' '),
      tone: 'pending',
      activityId: null,
      activityName: null,
    },
    productionState: null,
    qualityState: null,
    primaryDisplayState: {
      code: status,
      label: status.replaceAll('_', ' '),
      tone: 'pending',
      activityId: null,
      activityName: null,
    },
  },
  factoryConfirmationStatus: status === 'DRAFT' || status === 'SENT_TO_FACTORY' ? 'PENDING' : 'CONFIRMED',
  orderedQuantityTotal: 10,
  preparedQuantityTotal: 0,
  unitPrice: 199.5,
  version: 1,
  createdAt: '2026-07-31T10:00:00Z',
  confirmedAt: null,
  productionStartedAt: null,
  productionCompletedAt: null,
  processFlowVersion: { versionNumber: 1, processFlow: { name: 'Standard Flow' } },
  purchaseOrder: { poNumber: 'PO-001' },
  factory: { name: 'Test Factory' },
  confirmedBy: null,
  disclaimerText: null,
  disclaimerRevision: 0,
  acknowledgement: null,
  reworkTasks: [],
  qualityActivities: [],
  lines: [],
  stages:
    status === 'PRODUCTION_COMPLETE'
      ? stages.map((current) => ({ ...current, status: 'COMPLETED' as const }))
      : stages,
  ...overrides,
});

// Phase 2.1 Production Plan / Source Order Sheets fixtures, shared between
// the Overview tab (source add/remove) and Production tab (plan edit) tests
// since both exercise the same DRAFT job order shape.
export const draftOverrides = {
  lines: [
    {
      id: 'line-1',
      styleId: 'style-1',
      styleNumber: 'ST-1',
      styleName: 'Style One',
      orderedQuantityTotal: 10,
      preparedQuantityTotal: 0,
      status: 'DRAFT',
      sizes: [
        {
          id: 'size-1',
          sizeId: 'sz-1',
          sizeCode: 'S',
          sizeLabel: 'Small',
          orderedQuantity: 10,
          preparedQuantity: 0,
          varianceQuantity: 0,
        },
      ],
    },
  ],
  sourceOrderSheets: [
    {
      id: 'os-1',
      poNumber: 'EIOS/26-27/0001',
      distributor: { id: 'd1', code: 'D1', name: 'ABC Distributors' },
      purchaseMode: 'OUTRIGHT',
      requiredDeliveryDate: null,
      forecastTotal: 10,
    },
  ],
  combinedForecast: [{ sizeId: 'sz-1', sizeCode: 'S', sizeLabel: 'Small', forecastQuantity: 10 }],
  sourceOrderSheetCount: 1,
};

export const styleLookup = {
  id: 'style-1',
  sizes: [
    {
      id: 'sz-1',
      code: 'S',
      label: 'Small',
      sizeType: 'ALPHA',
      sortOrder: 1,
      status: 'ACTIVE',
      mappingStatus: 'ACTIVE',
    },
  ],
  factories: [],
};

export type Audit = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  metadata: unknown;
};

export const audit = (id: string, metadata: unknown, action = 'JOB_ORDER_STAGE_COMPLETED'): Audit => ({
  id,
  action,
  createdAt: '2026-07-31T10:00:00Z',
  actor: { id: 'actor-1', name: 'Alice', email: 'alice@test.local' },
  metadata,
});

export const finalQualityActivity = (overrides: Record<string, unknown> = {}) => ({
  processFlowVersionStageId: 'final-quality',
  sequence: 5,
  name: 'Final Inspection',
  status: 'AVAILABLE',
  eligible: true,
  qualityForm: {
    id: 'final-form',
    code: 'FINAL',
    name: 'Final Inspection Report',
    executionScope: 'JOB_ORDER',
  },
  qualityFormVersion: { id: 'final-version', versionNumber: 1 },
  executionMode: 'IN_PROCESS',
  associatedProductionActivity: null,
  availabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
  progressThresholdPercent: null,
  gateSatisfactionRequirement: 'FINALIZED',
  executionMultiplicity: 'BATCHED',
  coverageTarget: 'PREPARED_QUANTITY',
  coverage: {
    preparedQuantityAuthoritative: true,
    preparedQuantity: 40,
    inspectedQuantity: 0,
    remainingQuantity: 40,
    complete: false,
    reconciliationConflict: false,
    state: 'UNKNOWN',
    passedBatches: 0,
    failedBatches: 0,
    hasFailedBatches: false,
    batches: [],
    availableBySize: [
      {
        jobOrderLineSizeId: 'line-size-m',
        sizeCode: 'M',
        sizeLabel: 'M',
        preparedQuantity: 40,
        allocatedQuantity: 0,
        availableQuantity: 40,
      },
    ],
  },
  execution: null,
  executionHistory: [],
  ...overrides,
});
