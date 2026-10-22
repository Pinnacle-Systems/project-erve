import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pdf } from '@react-pdf/renderer';
import { JobOrderDetailDocument } from './JobOrderDetailDocument.js';
import { describe, expect, it } from 'vitest';
import type { JobOrder } from '../types.js';
import type { JobOrderQualityActivity, JobOrderSourceOrderSheet, JobOrderStage } from '@erve/types';
import { buildJobOrderDetailViewModel } from './buildJobOrderDetailViewModel.js';

function makeJobOrder(overrides: Partial<JobOrder> = {}): JobOrder {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    primaryStyle: {
      consistent: true,
      style: { id: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: null },
    },
    financialYear: { id: 'fy1', code: '2026-27' },
    factory: { id: 'f1', code: 'F1', name: 'Acme Factory' },
    unitPrice: 125.5,
    status: 'IN_PRODUCTION',
    operationalState: {
      lifecycleContext: {
        code: 'IN_PRODUCTION',
        label: 'In Production',
        tone: 'info',
        activityId: null,
        activityName: null,
      },
      productionState: null,
      qualityState: null,
      primaryDisplayState: {
        code: 'IN_PRODUCTION',
        label: 'In Production',
        tone: 'info',
        activityId: null,
        activityName: null,
      },
    },
    factoryConfirmationStatus: 'CONFIRMED',
    requiredDeliveryDate: '2026-06-01T00:00:00.000Z',
    deliveryDateLocked: true,
    isDelayed: false,
    orderedQuantityTotal: 500,
    preparedQuantityTotal: 200,
    sourceOrderSheetCount: 1,
    createdAt: '2026-04-01T00:00:00.000Z',
    version: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
    seasonSnapshots: [],
    processFlowVersion: {
      id: 'pfv1',
      versionNumber: 2,
      status: 'ACTIVE',
      processFlow: { id: 'pf1', code: 'PF1', name: 'Standard Flow' },
    },
    confirmedBy: { id: 'u2', name: 'Factory Rep', email: 'factory@erve.local' },
    confirmedAt: '2026-04-05T00:00:00.000Z',
    disclaimerText: null,
    disclaimerRevision: 0,
    acknowledgement: null,
    acknowledgements: [],
    productionStartedAt: '2026-04-10T00:00:00.000Z',
    productionCompletedAt: null,
    creator: { id: 'u1', name: 'Test User', email: 'test@erve.local' },
    lines: [
      {
        id: 'line-1',
        styleId: 'style-1',
        styleNumber: 'STY-0001',
        styleName: 'Basic Tee',
        primaryImage: null,
        orderedQuantityTotal: 500,
        preparedQuantityTotal: 200,
        status: 'IN_PRODUCTION',
        sizes: [
          {
            id: 'sz-1',
            sizeId: 'size-s',
            sizeCode: 'S',
            sizeLabel: 'Small',
            orderedQuantity: 200,
            preparedQuantity: 100,
            varianceQuantity: -100,
          },
          {
            id: 'sz-2',
            sizeId: 'size-m',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            orderedQuantity: 0,
            preparedQuantity: 0,
            varianceQuantity: 0,
          },
          {
            id: 'sz-3',
            sizeId: 'size-l',
            sizeCode: 'L',
            sizeLabel: 'Large',
            orderedQuantity: 300,
            preparedQuantity: 100,
            varianceQuantity: -200,
          },
        ],
      },
    ],
    stages: [],
    qualityActivities: [],
    reworkTasks: [],
    ...overrides,
  };
}

function ppSampleActivity(
  overrides: Partial<JobOrderQualityActivity> = {},
): JobOrderQualityActivity {
  return {
    processFlowVersionStageId: 'stage-pp-sample',
    sequence: 1,
    name: 'PP Sample',
    status: 'COMPLETED',
    eligible: true,
    qualityForm: {
      id: 'form-1',
      code: 'PP_SAMPLE',
      name: 'PP Sample Form',
      executionScope: 'SIZE',
    },
    qualityFormVersion: { id: 'fv-1', versionNumber: 1 },
    executionMode: 'SEQUENTIAL_GATE',
    associatedProductionActivity: null,
    availabilityPolicy: 'SEQUENTIAL_PREDECESSOR_COMPLETED',
    progressThresholdPercent: null,
    gateSatisfactionRequirement: 'OUTCOME_PASS',
    executionMultiplicity: 'SINGLE',
    coverageTarget: null,
    coverage: null,
    execution: {
      id: 'exec-1',
      attemptNumber: 1,
      batchNumber: 1,
      inspectedQuantity: null,
      status: 'FINALIZED',
      version: 1,
      outcome: 'PASS',
      startedAt: '2026-04-02T00:00:00.000Z',
      finalizedAt: '2026-04-03T00:00:00.000Z',
    },
    executionHistory: [],
    ...overrides,
  };
}

function ppmActivity(overrides: Partial<JobOrderQualityActivity> = {}): JobOrderQualityActivity {
  return {
    processFlowVersionStageId: 'stage-ppm',
    sequence: 2,
    name: 'PPM',
    status: 'COMPLETED',
    eligible: true,
    qualityForm: { id: 'form-2', code: 'PPM', name: 'PPM Form', executionScope: 'JOB_ORDER' },
    qualityFormVersion: { id: 'fv-2', versionNumber: 1 },
    executionMode: 'SEQUENTIAL_GATE',
    associatedProductionActivity: null,
    availabilityPolicy: 'SEQUENTIAL_PREDECESSOR_COMPLETED',
    progressThresholdPercent: null,
    gateSatisfactionRequirement: 'FINALIZED',
    executionMultiplicity: 'SINGLE',
    coverageTarget: null,
    coverage: null,
    execution: {
      id: 'exec-2',
      attemptNumber: 1,
      batchNumber: 1,
      inspectedQuantity: null,
      status: 'FINALIZED',
      version: 1,
      outcome: null,
      startedAt: '2026-04-02T00:00:00.000Z',
      finalizedAt: '2026-04-03T00:00:00.000Z',
    },
    executionHistory: [],
    ...overrides,
  };
}

function makeSourceOrderSheet(
  overrides: Partial<JobOrderSourceOrderSheet> = {},
): JobOrderSourceOrderSheet {
  return {
    id: 'os-1',
    poNumber: 'EIOS/26-27/0001',
    distributor: { id: 'd1', code: 'D1', name: 'Acme Distributors' },
    purchaseMode: 'OUTRIGHT',
    requiredDeliveryDate: '2026-05-01T00:00:00.000Z',
    styleId: 'style-1',
    forecastBySize: [],
    forecastTotal: 500,
    ...overrides,
  };
}

function makeStage(overrides: Partial<JobOrderStage> = {}): JobOrderStage {
  return {
    id: 'stage-1',
    processFlowVersionStageId: 'pfvs-1',
    stageSequence: 1,
    stageNameSnapshot: 'Cutting',
    status: 'COMPLETED',
    completedBy: { id: 'u3', name: 'Line Supervisor', email: 'supervisor@erve.local' },
    completedAt: '2026-04-12T00:00:00.000Z',
    remarks: null,
    createdAt: '2026-04-10T00:00:00.000Z',
    updatedAt: '2026-04-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildJobOrderDetailViewModel', () => {
  it('prints the authoritative persisted status, not a re-derived one', () => {
    const vm = buildJobOrderDetailViewModel(makeJobOrder({ status: 'PRODUCTION_COMPLETE' }), {
      generatedAt: '2026-09-12T10:00:00Z',
    });
    expect(vm.identityItems).toContainEqual({
      label: 'Lifecycle Status',
      value: 'Production Complete',
    });
  });

  it('never invents a Closed lifecycle label for a Job Order that has not reached it', () => {
    const vm = buildJobOrderDetailViewModel(makeJobOrder(), {
      generatedAt: '2026-09-12T10:00:00Z',
    });
    const serialized = JSON.stringify(vm).toLowerCase();
    expect(serialized).not.toContain('closed');
  });

  it('maps Style, Factory and size-wise quantities, keeping zero distinct from missing', () => {
    const vm = buildJobOrderDetailViewModel(makeJobOrder(), {
      generatedAt: '2026-09-12T10:00:00Z',
    });
    expect(JSON.stringify(vm)).not.toMatch(/variance/i);
    expect(vm.styleNumber).toBe('STY-0001');
    expect(vm.styleName).toBe('Basic Tee');
    const mediumSize = vm.sizes.find((s) => s.sizeCode === 'M');
    expect(mediumSize?.orderedQuantity).toBe(0);
    expect(mediumSize?.preparedQuantity).toBe(0);
    expect(vm.quantityTotalsLine).toBe('Ordered: 500  Prepared: 200');
  });

  it('omits the Source Order Sheets section (null) when the viewer record has no provenance', () => {
    const vm = buildJobOrderDetailViewModel(makeJobOrder({ sourceOrderSheets: undefined }), {
      generatedAt: '2026-09-12T10:00:00Z',
    });
    expect(vm.sourceOrderSheets).toBeNull();
  });

  it('maps multiple source Order Sheets across different distributors and mixed Purchase Modes without implying strict allocation', () => {
    const jobOrder = makeJobOrder({
      sourceOrderSheets: [
        makeSourceOrderSheet({
          id: 'os-1',
          distributor: { id: 'd1', code: 'D1', name: 'Distributor A' },
          purchaseMode: 'OUTRIGHT',
        }),
        makeSourceOrderSheet({
          id: 'os-2',
          poNumber: 'EIOS/26-27/0002',
          distributor: { id: 'd2', code: 'D2', name: 'Distributor B' },
          purchaseMode: 'SALE_RETURN',
        }),
      ],
    });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.sourceOrderSheets).toHaveLength(2);
    expect(vm.sourceOrderSheets?.map((r) => r.distributorName)).toEqual([
      'Distributor A',
      'Distributor B',
    ]);
    expect(vm.sourceOrderSheets?.map((r) => r.purchaseMode)).toEqual([
      'Outright',
      'Sale or Return',
    ]);
  });

  it("computes the combined forecast comparison using the Job Order's own quantities", () => {
    const jobOrder = makeJobOrder({
      sourceOrderSheets: [makeSourceOrderSheet()],
      combinedForecast: [
        { sizeId: 'size-s', sizeCode: 'S', sizeLabel: 'Small', forecastQuantity: 250 },
      ],
    });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.combinedForecast).toEqual([
      { sizeId: 'size-s', sizeLabel: 'Small', forecastQuantity: 250, jobOrderQuantity: 200 },
    ]);
  });

  it('shows PP Sample and PPM as independent rows with no synthetic PPM PASS/FAIL outcome', () => {
    const jobOrder = makeJobOrder({ qualityActivities: [ppSampleActivity(), ppmActivity()] });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.qualityActivities).toHaveLength(2);
    const ppSample = vm.qualityActivities.find((a) => a.name === 'PP Sample');
    const ppm = vm.qualityActivities.find((a) => a.name === 'PPM');
    expect(ppSample?.outcome).toBe('PASS');
    expect(ppSample?.gateRequirement).toBe('Pass required to proceed');
    expect(ppm?.outcome).toBeNull();
    expect(ppm?.gateRequirement).toBe('Finalized (no pass/fail outcome)');
  });

  it('orders quality activities by process-flow sequence without drawing a dependency chain', () => {
    const jobOrder = makeJobOrder({ qualityActivities: [ppmActivity(), ppSampleActivity()] });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.qualityActivities.map((a) => a.name)).toEqual(['PP Sample', 'PPM']);
  });

  it('does not treat an Inline QA failure as blocking (In-process mode is simply labeled, not gated)', () => {
    const inlineActivity = ppSampleActivity({
      processFlowVersionStageId: 'stage-inline',
      sequence: 3,
      name: 'Inline',
      executionMode: 'IN_PROCESS',
      gateSatisfactionRequirement: null,
      status: 'FAILED',
    });
    const jobOrder = makeJobOrder({ qualityActivities: [inlineActivity] });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.qualityActivities[0]?.mode).toBe('In-process');
    expect(vm.qualityActivities[0]?.gateRequirement).toBe('');
  });

  it('orders production stages by sequence and preserves completion attribution', () => {
    const jobOrder = makeJobOrder({
      stages: [
        makeStage({
          id: 's2',
          stageSequence: 2,
          stageNameSnapshot: 'Sewing',
          status: 'IN_PROGRESS',
          completedBy: null,
          completedAt: null,
        }),
        makeStage({ id: 's1', stageSequence: 1, stageNameSnapshot: 'Cutting' }),
      ],
    });
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    expect(vm.stages.map((s) => s.stageName)).toEqual(['Cutting', 'Sewing']);
    expect(vm.stages[1]?.completedByName).toBe('');
  });

  it('does not leak unrelated/internal properties into the printable view model', () => {
    const jobOrder = {
      ...makeJobOrder(),
      __internalDebugFlag: true,
      someAuditInternal: 'secret',
    } as JobOrder;
    const vm = buildJobOrderDetailViewModel(jobOrder, { generatedAt: '2026-09-12T10:00:00Z' });
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toContain('__internalDebugFlag');
    expect(serialized).not.toContain('someAuditInternal');
  });

  // recordOrigin=HISTORICAL_IMPORT: raw PENDING/0 are placeholders, never facts.
  it('preserves Not recorded historical quantities and omits variance', () => {
    const vm = buildJobOrderDetailViewModel(
      makeJobOrder({
        status: 'PRODUCTION_COMPLETE',
        factoryConfirmationStatus: 'PENDING',
        preparedQuantityTotal: 0,
        historicalImport: {
          legacyReferenceNumber: 'EI25018',
          historicalBusinessDate: '2025-08-15',
          importedAt: '2026-09-24T00:00:00Z',
        },
        lines: [
          {
            ...makeJobOrder().lines[0]!,
            sizes: [
              {
                id: 'sz-1',
                sizeId: 'size-s',
                sizeCode: 'S',
                sizeLabel: 'Small',
                orderedQuantity: 168,
                preparedQuantity: 0,
                varianceQuantity: -168,
              },
            ],
          },
        ],
      }),
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    const item = (label: string) => vm.identityItems.find((i) => i.label === label)?.value;
    expect(item('Factory Confirmation')).toBe('Not recorded');
    expect(item('Prepared Quantity')).toBe('Not recorded');
    expect(item('Variance')).toBeUndefined();
    expect(item('Lifecycle Status')).toBe('Production Complete');
    expect(vm.quantityTotalsLine).toBe('Ordered: 500  Prepared: Not recorded');
    expect(vm.sizes[0]).toMatchObject({ orderedQuantity: 168, preparedQuantity: 'Not recorded' });
  });

  it('keeps live confirmation labels and a recorded prepared 0 unchanged', () => {
    const unconfirmed = buildJobOrderDetailViewModel(
      makeJobOrder({
        status: 'SENT_TO_FACTORY',
        factoryConfirmationStatus: 'PENDING',
        preparedQuantityTotal: 0,
        historicalImport: null,
      }),
      { generatedAt: '2026-09-12T10:00:00Z' },
    );
    const item = (label: string) => unconfirmed.identityItems.find((i) => i.label === label)?.value;
    expect(item('Factory Confirmation')).toBe('Pending');
    expect(item('Prepared Quantity')).toBe(0);
    expect(item('Variance')).toBeUndefined();
    expect(unconfirmed.sizes[1]).toMatchObject({ preparedQuantity: 0 });
  });
});

it('writes complete builder-to-document synthetic evidence', async () => {
  const directory = process.env.PR2B_PDF_EVIDENCE_DIR;
  if (!directory) return;
  const image = {
    dataUri: `data:image/png;base64,${(await fs.readFile(new URL('../../../../public/erve-logo.png', import.meta.url))).toString('base64')}`,
  };
  for (const historical of [false, true]) {
    const jobOrder = makeJobOrder(
      historical
        ? {
            historicalImport: {
              legacyReferenceNumber: 'SYNTHETIC-LEGACY',
              historicalBusinessDate: '2025-08-15',
              importedAt: '2026-09-24T00:00:00Z',
            },
            preparedQuantityTotal: 0,
          }
        : {},
    );
    const original = structuredClone(jobOrder);
    const vm = buildJobOrderDetailViewModel(
      jobOrder,
      { generatedAt: '2026-09-12T10:00:00Z' },
      historical ? { placeholder: true } : image,
    );
    const blob = await pdf(JobOrderDetailDocument({ viewModel: vm })).toBlob();
    expect(jobOrder).toEqual(original);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `complete-${historical ? 'historical' : 'live'}.pdf`),
      Buffer.from(await blob.arrayBuffer()),
    );
  }
});


describe('ISS-042 inspection units', () => {
  it.each([
    [72, 72, 2, 0, 'Prepared: 72 pcs · Inspected: 72 pcs · Batches passed: 2 · Batches failed: 0'],
    [
      12500,
      10000,
      3,
      1,
      'Prepared: 12500 pcs · Inspected: 10000 pcs · Batches passed: 3 · Batches failed: 1',
    ],
    [0, 0, 0, 0, 'Prepared: 0 pcs · Inspected: 0 pcs · Batches passed: 0 · Batches failed: 0'],
    [
      null,
      18,
      1,
      0,
      'Prepared: pending · Inspected: 18 pcs · Batches passed: 1 · Batches failed: 0',
    ],
  ])(
    'exports distinct garment and batch units (%s prepared)',
    async (prepared, inspected, passed, failed, expected) => {
      const activity = ppSampleActivity({
        name: 'Final Inspection',
        coverage: {
          preparedQuantityAuthoritative: prepared !== null,
          preparedQuantity: prepared,
          inspectedQuantity: inspected + 90,
          inspectedPhysicalCoverage: inspected,
          remainingQuantity: 0,
          complete: true,
          reconciliationConflict: false,
          state: 'COMPLETE',
          passedBatches: passed,
          failedBatches: failed,
          hasFailedBatches: failed > 0,
          batches: [
            {
              id: 'physical-1',
              batchNumber: 1,
              inspectedQuantity: inspected,
              status: 'FINALIZED',
              outcome: 'PASS',
              finalizedAt: null,
              attemptCount: 7,
            },
          ],
        },
      });
      const model = buildJobOrderDetailViewModel(makeJobOrder({ qualityActivities: [activity] }), {
        generatedAt: '2026-10-22T10:00:00Z',
      });
      expect(model.qualityActivities[0]?.coverageSummary).toBe(expected);
      const blob = await pdf(JobOrderDetailDocument({ viewModel: model })).toBlob();
      const task = getDocument({
        data: new Uint8Array(await blob.arrayBuffer()),
        useSystemFonts: true,
      });
      try {
        const doc = await task.promise;
        let text = '';
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          text +=
            content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ') + ' ';
        }
        expect(text.replace(/\s+/g, ' ')).toContain(expected);
      } finally {
        await task.destroy();
      }
    },
  );
});
