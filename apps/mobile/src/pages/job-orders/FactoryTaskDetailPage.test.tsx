/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JobOrderDetail, JobOrderStage } from '@erve/types';

const authState = vi.hoisted(() => ({ roles: ['FACTORY_USER'] }));

vi.mock('../../auth/AuthContext.js', () => ({
  useAuth: () => ({ user: { roles: authState.roles } }),
}));
vi.mock('../../lib/api-client.js', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import { apiClient } from '../../lib/api-client.js';
import { FactoryTaskDetailPage } from './FactoryTaskDetailPage.js';

let container: HTMLDivElement;
let root: Root;

const stage = (
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
  completedBy: null,
  completedAt: status === 'COMPLETED' ? '2026-08-20T10:00:00Z' : null,
  remarks: null,
  createdAt: '2026-08-19T10:00:00Z',
  updatedAt: '2026-08-20T10:00:00Z',
});

const stages = [
  stage('cutting', 'Cutting', 1, 'COMPLETED'),
  stage('printing', 'Printing', 2, 'IN_PROGRESS'),
  stage('sewing', 'Sewing', 3, 'NOT_STARTED'),
];

function job(overrides: Partial<JobOrderDetail> = {}): JobOrderDetail {
  return {
    id: 'job-1',
    jobOrderNumber: 'JO-001',
    status: 'IN_PRODUCTION',
    version: 1,
    purchaseOrder: { id: 'po-1', poNumber: 'PO-001', status: 'FULLY_JOB_ORDERED' },
    factory: { id: 'factory-1', code: 'F1', name: 'Factory One' },
    unitPrice: 100,
    orderedQuantityTotal: 60,
    preparedQuantityTotal: 0,
    operationalState: {
      lifecycleContext: {
        code: 'IN_PRODUCTION',
        label: 'In Production',
        tone: 'info',
        activityId: null,
        activityName: null,
      },
      productionState: {
        code: 'IN_PROGRESS',
        label: 'Printing In Progress',
        tone: 'info',
        activityId: 'printing',
        activityName: 'Printing',
      },
      qualityState: null,
      primaryDisplayState: {
        code: 'IN_PROGRESS',
        label: 'Printing In Progress',
        tone: 'info',
        activityId: 'printing',
        activityName: 'Printing',
      },
    },
    factoryConfirmationStatus: 'CONFIRMED',
    seasonSnapshots: [],
    processFlowVersion: {
      id: 'flow-version-1',
      versionNumber: 1,
      status: 'ACTIVE',
      processFlow: { id: 'flow-1', code: 'DEFAULT', name: 'Default Flow' },
    },
    confirmedBy: null,
    confirmedAt: null,
    disclaimerText: 'Factory terms',
    disclaimerRevision: 1,
    acknowledgement: null,
    acknowledgements: [],
    productionStartedAt: '2026-08-20T10:00:00Z',
    productionCompletedAt: null,
    creator: { id: 'user-1', name: 'User', email: 'user@example.test' },
    lines: [],
    stages,
    qualityActivities: [],
    reworkTasks: [],
    finalBatchReworks: [],
    createdAt: '2026-08-19T10:00:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    ...overrides,
  } as JobOrderDetail;
}

async function renderTask(value: JobOrderDetail) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: value } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/factory-tasks/job-1']}>
          <Routes>
            <Route path="/factory-tasks/:id" element={<FactoryTaskDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading task'));
}

beforeEach(() => {
  authState.roles = ['FACTORY_USER'];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

const finalQualityActivity = () => ({
  processFlowVersionStageId: 'final-quality',
  sequence: 5,
  name: 'Final Inspection',
  status: 'AVAILABLE' as const,
  eligible: true,
  qualityForm: {
    id: 'final-form',
    code: 'FINAL',
    name: 'Final Inspection Report',
    executionScope: 'JOB_ORDER' as const,
  },
  qualityFormVersion: { id: 'final-version', versionNumber: 1 },
  executionMode: 'IN_PROCESS' as const,
  associatedProductionActivity: null,
  availabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES' as const,
  progressThresholdPercent: null,
  gateSatisfactionRequirement: 'FINALIZED' as const,
  executionMultiplicity: 'BATCHED' as const,
  coverageTarget: 'PREPARED_QUANTITY' as const,
  coverage: {
    preparedQuantityAuthoritative: true,
    preparedQuantity: 20,
    inspectedQuantity: 0,
    remainingQuantity: 20,
    complete: false,
    reconciliationConflict: false,
    state: 'UNKNOWN' as const,
    passedBatches: 0,
    failedBatches: 0,
    hasFailedBatches: false,
    batches: [],
    availableBySize: [
      {
        jobOrderLineSizeId: 'line-size-m',
        sizeCode: 'M',
        sizeLabel: 'M',
        preparedQuantity: 20,
        allocatedQuantity: 0,
        availableQuantity: 20,
      },
    ],
  },
  execution: null,
  executionHistory: [],
});

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('FactoryTaskDetailPage production stages', () => {
  it('validates a Final size allocation and starts only after correction', async () => {
    authState.roles = ['QA_USER'];
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { data: { id: 'execution-1', jobOrderId: 'job-1', ppSample: null } },
    });
    await renderTask(job({ qualityActivities: [finalQualityActivity()] }));
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size M"]',
    ) as HTMLInputElement;

    act(() => start.click());
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Allocate at least one prepared unit to this Final batch.',
    );

    await act(async () => changeInput(quantity, '12'));
    expect(container.textContent).not.toContain('Allocate at least one prepared unit');

    await act(async () => {
      start.click();
      start.click();
    });
    expect(apiClient.post).toHaveBeenCalledOnce();
    expect(apiClient.post).toHaveBeenCalledWith(
      '/job-orders/job-1/quality-activities/final-quality/executions',
      { allocations: [{ jobOrderLineSizeId: 'line-size-m', quantity: 12 }] },
    );
  });

  it('preserves the original mobile list and omits quantitative progress text', async () => {
    await renderTask(job());

    expect(container.textContent).toContain('Production stages');
    expect(container.textContent).toContain('1. CuttingCOMPLETED');
    expect(container.textContent).toContain('2. PrintingIN PROGRESS');
    expect(container.querySelector('ol')?.className).toContain('space-y-3');
    expect(container.textContent).not.toContain('30 / 60 completed');
    expect(container.textContent).not.toContain('50%');
    expect(container.textContent).not.toContain('Historical progress not captured');
    expect(container.textContent).not.toContain('Planned Production Flow');
    expect(container.textContent).not.toContain('Workflow sequence only');
    expect(container.textContent).not.toContain('completed quantity');
    expect(container.textContent).not.toContain('Save progress');
    expect(container.textContent).toContain('Complete Printing');
  });

  it('shows only Start for a not-started Production stage', async () => {
    await renderTask(
      job({
        status: 'CONFIRMED_BY_FACTORY',
        stages: [stage('cutting', 'Cutting', 1, 'NOT_STARTED')],
      }),
    );

    expect(container.textContent).toContain('Start Cutting');
    expect(container.textContent).not.toContain('Complete Cutting');
    expect(container.textContent).not.toContain('completed quantity');
    expect(container.textContent).not.toContain('Save progress');
  });

  it('retains the pre-production Quality lock message with the original list', async () => {
    await renderTask(
      job({
        status: 'CONFIRMED_BY_FACTORY',
        qualityActivities: [
          {
            processFlowVersionStageId: 'quality-1',
            sequence: 1,
            name: 'Size Set / Pre-Production Report',
            status: 'AVAILABLE',
            eligible: true,
            qualityForm: {
              id: 'form-1',
              code: 'PP_REPORT',
              name: 'Size Set / Pre-Production Report',
              executionScope: 'JOB_ORDER',
            },
            qualityFormVersion: { id: 'form-version-1', versionNumber: 1 },
            executionMode: 'SEQUENTIAL_GATE',
            associatedProductionActivity: null,
            availabilityPolicy: 'SEQUENTIAL_PREDECESSOR_COMPLETED',
            progressThresholdPercent: null,
            gateSatisfactionRequirement: 'FINALIZED',
            executionMultiplicity: 'SINGLE',
            coverageTarget: null,
            coverage: null,
            execution: null,
            executionHistory: [],
          },
        ],
      }),
    );

    expect(container.textContent).toContain('Production stages');
    expect(container.textContent).toContain('Production locked pending pre-production QA');
    expect(container.textContent).not.toContain('30 / 60 completed');
    expect(container.textContent).not.toContain('50%');
  });
});

const finalBatchRework = (
  status: 'REQUIRED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' = 'REQUIRED',
) => ({
  id: 'rework-1',
  finalQualityBatchId: 'batch-1',
  jobOrderId: 'job-1',
  jobOrderNumber: 'JO-001',
  processFlowActivityId: 'final-quality',
  activityName: 'Final Inspection',
  batchNumber: 1,
  physicalQuantity: 30,
  allocations: [{ jobOrderLineSizeId: 'line-size-m', sizeCode: 'M', sizeLabel: 'M', quantity: 30 }],
  cycleNumber: 1,
  status,
  failedAttemptNumber: 1,
  failedAt: '2026-08-20T10:00:00Z',
  qaRemarks: 'Loose stitching on the collar',
  notes: null,
  acknowledgedBy: null,
  acknowledgedAt: null,
  startedBy: null,
  startedAt: null,
  completedBy: null,
  completedAt: null,
  previousCycles: [],
  version: 1,
  updatedAt: '2026-08-20T10:00:00Z',
});

describe('FactoryTaskDetailPage Final batch rework', () => {
  it('shows the required action for the current rework status and posts the matching transition', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { data: {} } });
    await renderTask(job({ finalBatchReworks: [finalBatchRework('REQUIRED')] }));

    expect(container.textContent).toContain('Final batches needing rework');
    expect(container.textContent).toContain('Loose stitching on the collar');
    const acknowledge = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Acknowledge rework',
    ) as HTMLButtonElement;
    expect(acknowledge).toBeTruthy();
    expect(container.textContent).not.toContain('Start rework');
    expect(container.textContent).not.toContain('Complete rework');

    await act(async () => acknowledge.click());
    expect(apiClient.post).toHaveBeenCalledWith(
      '/quality-executions/final-batches/batch-1/rework/acknowledge',
      { expectedVersion: 1, notes: undefined },
    );
  });

  it('requires notes before Complete rework is enabled and sends them on click', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { data: {} } });
    await renderTask(job({ finalBatchReworks: [finalBatchRework('IN_PROGRESS')] }));

    const complete = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Complete rework',
    ) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);

    const notes = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(notes, 'Fixed the seam');
      notes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(complete.disabled).toBe(false);

    await act(async () => complete.click());
    expect(apiClient.post).toHaveBeenCalledWith(
      '/quality-executions/final-batches/batch-1/rework/complete',
      { expectedVersion: 1, notes: 'Fixed the seam' },
    );
  });

  it('does not offer Factory rework actions to non-Factory roles', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderTask(job({ finalBatchReworks: [finalBatchRework('REQUIRED')] }));

    expect(container.textContent).toContain('Final batches needing rework');
    expect(container.textContent).not.toContain('Acknowledge rework');
  });
});
