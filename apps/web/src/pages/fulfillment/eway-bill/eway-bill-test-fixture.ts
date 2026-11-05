import type {
  EwayBillAssociationSummary,
  EwayBillAttemptView,
  EwayBillGenerationPreviewResponse,
  EwayBillHistoryResponse,
  EwayBillMovementInfo,
  EwayBillMovementRecord,
  EwayBillReadinessResponse,
  EwayBillRecordView,
} from '@erve/types';

export const emptyMovement = (): EwayBillMovementInfo => ({
  transportMode: null,
  vehicleNumber: null,
  vehicleType: null,
  transporterId: null,
  transporterName: null,
  transportDocumentNumber: null,
  transportDocumentDate: null,
  approximateDistanceKm: null,
  shipToArrangement: null,
  dispatchFromArrangement: null,
  dispatchFrom: null,
});

export const completeMovement = (): EwayBillMovementInfo => ({
  transportMode: 'ROAD',
  vehicleNumber: 'MH12AB1234',
  vehicleType: 'REGULAR',
  transporterId: null,
  transporterName: 'Fast Movers',
  transportDocumentNumber: 'LR-100',
  transportDocumentDate: '2026-11-04',
  approximateDistanceKm: 0,
  shipToArrangement: 'BILLED_PARTY',
  dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
  dispatchFrom: null,
});

export function movementRecord(
  movement: EwayBillMovementInfo = emptyMovement(),
  version = 0,
): EwayBillMovementRecord {
  return {
    taxInvoiceId: 'inv-1',
    version,
    captured: version > 0,
    movement,
    updatedAt: version > 0 ? '2026-11-04T05:00:00.000Z' : null,
    updatedBy: version > 0 ? { id: 'acct-1', name: 'Accountant One' } : null,
  };
}

export const noLinkage = (): EwayBillReadinessResponse['linkage'] => ({
  state: 'NONE',
  ewayBill: null,
  unverifiedReference: null,
  satisfiesStatutoryClearance: false,
  syntheticRecords: { activeDemoBills: 0, openDemoAttempts: 0, demoBill: null },
});

export function association(
  overrides: Partial<EwayBillAssociationSummary> = {},
): EwayBillAssociationSummary {
  return {
    id: 'bill-1',
    source: 'PROVIDER_GENERATED',
    integrationMode: 'DEMO',
    ewayBillNumber: 'TEST-0001',
    verificationStatus: 'SYNTHETIC_DEMO',
    generatedAt: '2026-11-04T06:00:00.000Z',
    validUntil: null,
    ...overrides,
  };
}

export function readinessFixture(
  overrides: Partial<EwayBillReadinessResponse> = {},
): EwayBillReadinessResponse {
  return {
    taxInvoiceId: 'inv-1',
    invoiceNumber: 'EI/26-27/0001',
    invoiceStatus: 'FINALIZED',
    applicability: { outcome: 'APPLICABLE', reasons: [], ruleSetVersion: 'v1' },
    linkage: noLinkage(),
    readiness: {
      outcome: 'READY',
      blockers: [],
      requirementsVerification: 'PARTIAL',
      unverifiedRequirements: [],
    },
    reviewFlags: [],
    capabilities: {
      providerGenerationEnabled: true,
      demoGenerationAvailable: true,
      liveGenerationAvailable: false,
      externalLinkAvailable: true,
    },
    evaluatedAt: '2026-11-04T07:00:00.000Z',
    ...overrides,
  };
}

export function previewFixture(
  overrides: Partial<EwayBillGenerationPreviewResponse> = {},
): EwayBillGenerationPreviewResponse {
  return {
    taxInvoiceId: 'inv-1',
    invoiceNumber: 'EI/26-27/0001',
    invoiceStatus: 'FINALIZED',
    movementVersion: 3,
    applicability: { outcome: 'APPLICABLE', reasons: [], ruleSetVersion: 'v1' },
    acknowledgementRequired: false,
    demo: { integrationMode: 'DEMO', available: true, blockers: [] },
    live: { available: false, blockers: [] },
    request: {
      ready: true,
      blockers: [],
      warnings: [],
      assumptions: [],
      classification: { transactionType: 1, shipTo: 'BILLED_PARTY', dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' },
      document: { type: 'INV', number: 'EI/26-27/0001', date: '2026-11-04' },
      itemCount: 2,
    },
    linkage: noLinkage(),
    evaluatedAt: '2026-11-04T07:00:00.000Z',
    ...overrides,
  };
}

export function attemptFixture(overrides: Partial<EwayBillAttemptView> = {}): EwayBillAttemptView {
  return {
    id: 'attempt-1',
    integrationMode: 'DEMO',
    outcome: 'UNCERTAIN',
    open: true,
    requiresReview: true,
    actor: { id: 'acct-1', name: 'Accountant One' },
    document: { type: 'INV', number: 'EI/26-27/0001', date: '2026-11-04' },
    settingsVersion: 1,
    movementVersion: 3,
    failureCode: 'TIMEOUT',
    failureMessage: 'The provider did not answer in time. The outcome is unknown.',
    createdAt: '2026-11-04T06:00:00.000Z',
    dispatchedAt: '2026-11-04T06:00:01.000Z',
    completedAt: null,
    reviewAfter: '2026-11-04T06:03:00.000Z',
    resolution: null,
    ewayBillId: null,
    ...overrides,
  };
}

export function billFixture(overrides: Partial<EwayBillRecordView> = {}): EwayBillRecordView {
  return {
    id: 'bill-1',
    source: 'PROVIDER_GENERATED',
    status: 'ACTIVE',
    integrationMode: 'DEMO',
    verificationStatus: 'SYNTHETIC_DEMO',
    verifiedAt: null,
    ewayBillNumber: 'TEST-0001',
    generatedAt: '2026-11-04T06:00:00.000Z',
    validUntil: null,
    requestAttemptId: 'attempt-1',
    createdAt: '2026-11-04T06:00:00.000Z',
    createdBy: { id: 'acct-1', name: 'Accountant One' },
    ...overrides,
  };
}

export function historyFixture(
  overrides: Partial<EwayBillHistoryResponse> = {},
): EwayBillHistoryResponse {
  return { taxInvoiceId: 'inv-1', attempts: [], ewayBills: [], events: [], ...overrides };
}
