/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobOrderDetailPage } from './JobOrderDetailPage.js';
import { ProductionStageStepper } from './ProductionStageStepper.js';
import { apiClient } from '../../lib/api-client.js';
import type { JobOrderStage } from './types.js';
import { STAGE_LABELS } from './job-order-ui.js';

const authState = vi.hoisted(() => ({ roles: ['MERCHANDISER', 'FACTORY_USER'] }));

vi.mock('../../auth/AuthContext.js', () => ({
  useOptionalAuth: () => ({ user: { roles: authState.roles } }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.roles = ['MERCHANDISER', 'FACTORY_USER'];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

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
  completedAt: status === 'COMPLETED' ? '2026-07-31T10:00:00Z' : null,
  completedBy:
    status === 'COMPLETED' ? { id: 'user-1', name: 'Alice', email: 'alice@test.local' } : null,
  remarks: null,
  createdAt: '2026-07-30T10:00:00Z',
  updatedAt: '2026-07-31T10:00:00Z',
});

const standardStages = [
  stage('stage-1', 'Cutting', 1, 'NOT_STARTED'),
  stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
  stage('stage-3', 'Sewing', 3, 'NOT_STARTED'),
  stage('stage-4', 'Finishing', 4, 'NOT_STARTED'),
];

const mockJobOrder = (
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
  factoryConfirmationStatus:
    status === 'DRAFT' || status === 'SENT_TO_FACTORY' ? 'PENDING' : 'CONFIRMED',
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

type Audit = {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
  metadata: unknown;
};

const renderPage = async (
  status: string,
  stages: JobOrderStage[] = standardStages,
  audits: Audit[] = [],
  overrides: Record<string, unknown> = {},
) => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) =>
    url.endsWith('/audit')
      ? { data: { data: audits } }
      : { data: { data: mockJobOrder(status, stages, overrides) } },
  );

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/job-orders/jo-1']}>
          <Routes>
            <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  await vi.waitFor(() => expect(container.textContent).not.toContain('Loading job order'));
};

const content = () => container.textContent ?? '';
const changeTextarea = (textarea: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
};

const changeInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const finalQualityActivity = (overrides: Record<string, unknown> = {}) => ({
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

describe('ProductionStageStepper', () => {
  it('renders nothing when production stages are empty', () => {
    act(() => {
      root.render(<ProductionStageStepper stages={[]} isPreparedQuantitiesUnlocked={true} />);
    });
    expect(container.innerHTML).toBe('');
  });
});

describe('JobOrderDetailPage workflow rendering', () => {
  it('validates a Final size allocation, clears the error, and starts once', async () => {
    authState.roles = ['QA_USER'];
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        data: {
          id: 'execution-1',
          jobOrderId: 'jo-1',
          ppSample: null,
        },
      },
    });
    await renderPage('IN_PRODUCTION', standardStages, [], {
      qualityActivities: [finalQualityActivity()],
    });
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size M"]',
    ) as HTMLInputElement;

    act(() => start.click());

    expect(post).not.toHaveBeenCalled();
    expect(content()).toContain('Allocate at least one prepared unit to this Final batch.');

    await act(async () => changeInput(quantity, '0'));
    act(() => start.click());
    expect(post).not.toHaveBeenCalled();
    expect(content()).toContain('Allocate at least one prepared unit to this Final batch.');

    await act(async () => changeInput(quantity, '-1'));
    act(() => start.click());
    expect(post).not.toHaveBeenCalled();
    expect(content()).toContain('Allocate at least one prepared unit to this Final batch.');

    await act(async () => changeInput(quantity, '1.5'));
    act(() => start.click());
    expect(post).not.toHaveBeenCalled();
    expect(content()).toContain(
      'Each batch allocation must be a whole number within the available size quantity.',
    );

    await act(async () => changeInput(quantity, '25'));
    expect(content()).not.toContain('Allocate at least one prepared unit');

    await act(async () => {
      start.click();
      start.click();
    });
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(
      '/job-orders/jo-1/quality-activities/final-quality/executions',
      { allocations: [{ jobOrderLineSizeId: 'line-size-m', quantity: 25 }] },
    );
  });

  it('surfaces a Final allocation conflict returned by the API', async () => {
    authState.roles = ['QA_USER'];
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Final batch allocation exceeds available prepared quantity',
          },
        },
      },
    });
    await renderPage('IN_PRODUCTION', standardStages, [], {
      qualityActivities: [finalQualityActivity()],
    });
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size M"]',
    ) as HTMLInputElement;
    await act(async () => changeInput(quantity, '25'));
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;

    await act(async () => start.click());
    await vi.waitFor(() =>
      expect(content()).toContain('Final batch allocation exceeds available prepared quantity'),
    );

    expect(quantity.value).toBe('25');
  });

  it('shows primary Production and concurrent Quality without duplicating Production or Lifecycle', async () => {
    const concurrentStages = [
      stage('stage-1', 'Cutting', 1, 'COMPLETED'),
      stage('stage-2', 'Printing', 2, 'COMPLETED'),
      stage('stage-3', 'Sewing', 3, 'IN_PROGRESS'),
      stage('stage-4', 'Finishing', 4, 'NOT_STARTED'),
    ];
    await renderPage('CONFIRMED_BY_FACTORY', concurrentStages, [], {
      operationalState: {
        lifecycleContext: {
          code: 'CONFIRMED_BY_FACTORY',
          label: 'Factory Confirmed',
          tone: 'pending',
          activityId: null,
          activityName: null,
        },
        productionState: {
          code: 'IN_PROGRESS',
          label: 'Sewing In Progress',
          tone: 'info',
          activityId: 'sewing',
          activityName: 'Sewing',
        },
        qualityState: {
          code: 'PENDING',
          label: 'Inline Inspection Pending',
          tone: 'pending',
          activityId: 'inline',
          activityName: 'Inline Inspection',
        },
        primaryDisplayState: {
          code: 'IN_PROGRESS',
          label: 'Sewing In Progress',
          tone: 'info',
          activityId: 'sewing',
          activityName: 'Sewing',
        },
      },
    });
    const operational = container.querySelector(
      '[aria-label="Current Job Order operational state"]',
    )!;
    expect(operational.textContent).toContain('Current Activity');
    expect(operational.textContent).toContain('Sewing');
    expect(operational.textContent).toContain('In Progress');
    expect(operational.textContent).toContain('Quality');
    expect(operational.textContent).toContain('Inline Inspection');
    expect(operational.textContent?.match(/Sewing/g)).toHaveLength(1);
    expect(operational.textContent).not.toContain('Lifecycle');
    expect(content()).toContain('Lifecycle');
    expect(content()).toContain('Confirmed');
    const detailLabels = Array.from(container.querySelectorAll('.text-label')).map(
      (item) => item.textContent,
    );
    expect(detailLabels).toContain('Lifecycle');
    expect(detailLabels).not.toContain('Confirmation');
    const currentStage = container.querySelector('li[aria-current="step"]')!;
    expect(currentStage.textContent).toContain('SewingCurrent');
    expect(content()).not.toContain('10 / 10 completed');
    expect(content()).not.toContain('100%');
    expect(content()).not.toContain('Completed quantity');
    expect(content()).not.toContain('Save progress');
  });

  it('prioritizes pending pre-production Quality and presents Production as locked', async () => {
    await renderPage('CONFIRMED_BY_FACTORY', standardStages, [], {
      operationalState: {
        lifecycleContext: {
          code: 'CONFIRMED_BY_FACTORY',
          label: 'Factory Confirmed',
          tone: 'pending',
          activityId: null,
          activityName: null,
        },
        productionState: {
          code: 'LOCKED',
          label: 'Production Locked',
          tone: 'pending',
          activityId: null,
          activityName: null,
        },
        qualityState: {
          code: 'PENDING',
          label: 'Size Set / Pre-Production Report Pending',
          tone: 'pending',
          activityId: 'quality-1',
          activityName: 'Size Set / Pre-Production Report',
        },
        primaryDisplayState: {
          code: 'PENDING',
          label: 'Size Set / Pre-Production Report Pending',
          tone: 'pending',
          activityId: 'quality-1',
          activityName: 'Size Set / Pre-Production Report',
        },
      },
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
    });

    const operational = container.querySelector(
      '[aria-label="Current Job Order operational state"]',
    )!;
    expect(operational.textContent).toContain('Current Activity');
    expect(operational.textContent).toContain('Size Set / Pre-Production Report');
    expect(operational.textContent).toContain('Pending');
    expect(operational.textContent).toContain('Production:Locked');
    expect(content()).toContain('Locked until pre-production Quality gates are completed.');
    expect(content()).not.toContain('Planned Production Flow');
    expect(content()).not.toContain('Workflow sequence only');
    const currentStage = container.querySelector('li[aria-current="step"]')!;
    expect(currentStage.textContent).toContain('CuttingCurrent');
    expect(currentStage.closest('ol')?.querySelectorAll('.rounded-full')).toHaveLength(5);
    expect(content()).toContain('Quality activities');
    expect(content()).toContain('Available');
    expect(content()).not.toContain('0 / 10');
    expect(content()).not.toContain('0%');
    expect(content()).not.toContain('Historical progress not captured');
  });

  it('shows size-level rework inside the original Job Order and performs factory actions', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: {} } });
    await renderPage('REWORK_REQUIRED', standardStages, [], {
      reworkTasks: [
        {
          id: 'rework-1',
          jobOrderId: 'jo-1',
          jobOrderNumber: 'JO-001',
          jobOrderLineSizeId: 'size-m',
          styleNumber: 'ST-101',
          styleName: 'Oxford Shirt',
          sizeCode: 'M',
          sizeLabel: 'Medium',
          assignedQuantity: 4,
          attemptNumber: 1,
          status: 'REWORK_REQUIRED',
          defectCategory: 'STITCHING',
          otherDefectDetails: null,
          defectNotes: 'Loose cuff seam',
          qaRemarks: 'Repair the cuff and present all four units.',
          qaEvidence: [],
          requestedBy: { id: 'qa-1', name: 'QA Inspector', email: 'qa@test.local' },
          requestedAt: '2026-08-09T10:00:00Z',
          factoryNotes: null,
          acknowledgedBy: null,
          acknowledgedAt: null,
          readyBy: null,
          readyAt: null,
          reinspectedAt: null,
          version: 1,
          updatedAt: '2026-08-09T10:00:00Z',
        },
      ],
    });

    expect(content()).toContain('Current open rework');
    expect(content()).toContain('JO-001 · ST-101 Oxford Shirt · Size Medium');
    expect(content()).toContain('Requested quantity4');
    expect(content()).toContain('Loose cuff seam');
    expect(content()).toContain('Repair the cuff and present all four units.');
    expect(content()).not.toContain('rework-1');

    const acknowledge = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Acknowledge rework',
    ) as HTMLButtonElement;
    await act(async () => acknowledge.click());
    expect(post).toHaveBeenCalledWith(
      '/qa/rework/rework-1/acknowledge',
      { expectedVersion: 1, notes: null },
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('renders the draft notice without production controls', async () => {
    await renderPage('DRAFT');
    expect(content()).toContain('Production workflow not started');
    expect(content()).toContain('Send this job order to the factory');
    expect(content()).not.toContain('Prepared Quantities');
    expect(content()).not.toContain('Current Stage:');
  });

  it('blocks send before the API call and focuses the required disclaimer', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPage('DRAFT');
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;

    act(() => send.click());

    const disclaimer = container.querySelector('#job-order-disclaimer') as HTMLTextAreaElement;
    const disclaimerLabel = container.querySelector(
      'label[for="job-order-disclaimer"] > span',
    ) as HTMLSpanElement;
    expect(post).not.toHaveBeenCalled();
    expect(disclaimerLabel.textContent?.replace(/\s+/g, ' ').trim()).toBe('Disclaimer *');
    expect(disclaimer.required).toBe(true);
    expect(disclaimer.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(disclaimer);
    expect(content()).toContain(
      'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.',
    );
    expect(content()).not.toContain('Send job order to factory?');

    await act(async () => changeTextarea(disclaimer, 'Factory terms'));
    expect(disclaimer.getAttribute('aria-invalid')).toBeNull();
    expect(content()).not.toContain(
      'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.',
    );
  });

  it('requires an edited disclaimer to be saved before opening send confirmation', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPage('DRAFT', standardStages, [], { disclaimerText: 'Persisted terms' });
    const disclaimer = container.querySelector('#job-order-disclaimer') as HTMLTextAreaElement;
    await act(async () => changeTextarea(disclaimer, 'Unsaved replacement terms'));
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;

    act(() => send.click());

    expect(post).not.toHaveBeenCalled();
    expect(content()).toContain(
      'Save the disclaimer before sending this Job Order to the factory.',
    );
    expect(document.activeElement).toBe(disclaimer);
  });

  it('maps a backend disclaimer error to actionable feedback instead of Axios text', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        data: {
          error: {
            code: 'DISCLAIMER_REQUIRED',
            message: 'A factory commercial terms / disclaimer is required',
          },
        },
      },
    });
    await renderPage('DRAFT', standardStages, [], { disclaimerText: 'Persisted terms' });
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;
    act(() => send.click());
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send',
    ) as HTMLButtonElement;

    await act(async () => confirm.click());

    await vi.waitFor(() =>
      expect(content()).toContain(
        'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.',
      ),
    );
    expect(content()).not.toContain('Request failed with status code 400');
  });

  it('renders the awaiting-confirmation notice without production controls', async () => {
    await renderPage('SENT_TO_FACTORY');
    expect(content()).toContain('Awaiting factory confirmation');
    expect(content()).not.toContain('Prepared Quantities');
    expect(content()).not.toContain('Current Stage:');
  });

  it.each(['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'])(
    'renders the guided workflow for %s',
    async (status) => {
      await renderPage(status);
      expect(content()).toContain('Cutting');
      expect(content()).toContain('Printing');
      expect(content()).toContain('Current Stage: Cutting');
      expect(content()).toContain(
        'Prepared quantities become available after Finishing satisfies the Process Flow rule.',
      );
    },
  );

  it('renders unlocked prepared quantities after production completes', async () => {
    await renderPage('PRODUCTION_COMPLETE');
    expect(content()).toContain('Cutting');
    expect(content()).toContain(
      'Update the cumulative size-wise quantity prepared for Final inspection so far.',
    );
    expect(content()).not.toContain('Prepared quantities become available after');
  });

  it('renders custom stages in server-provided order without hard-coded names', async () => {
    const customStages = [
      stage('custom-1', 'Fabric Preparation', 1, 'NOT_STARTED'),
      stage('custom-2', 'Embroidery', 2, 'NOT_STARTED'),
      stage('custom-3', 'Final Inspection', 3, 'NOT_STARTED'),
    ];
    await renderPage('IN_PRODUCTION', customStages);
    expect(content()).toContain('Fabric Preparation');
    expect(content()).toContain('Embroidery');
    expect(content()).toContain('Final Inspection');
    expect(content()).toContain('Current Stage: Fabric Preparation');
    expect(content()).toContain(
      'Prepared quantities become available after Final Inspection satisfies the Process Flow rule.',
    );
    expect(content()).not.toContain('Cutting');
  });
});

describe('JobOrderDetailPage audit history', () => {
  const audit = (id: string, metadata: unknown, action = 'JOB_ORDER_STAGE_COMPLETED'): Audit => ({
    id,
    action,
    createdAt: '2026-07-31T10:00:00Z',
    actor: { id: 'actor-1', name: 'Alice', email: 'alice@test.local' },
    metadata,
  });

  it('renders valid stage names while preserving actor and timestamp', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('cutting', { stageName: ' Cutting ' }),
    ]);
    expect(content()).toContain('Production stage completed — Cutting');
    expect(content()).toContain('Alice');
    expect(content()).toContain('31 Jul 2026');
  });

  it('renders known generic actions in sentence case', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('created', null, 'JOB_ORDER_CREATED'),
      audit('sent', null, 'JOB_ORDER_SENT_TO_FACTORY'),
      audit('confirmed', null, 'JOB_ORDER_FACTORY_CONFIRMED'),
      audit('prepared', null, 'JOB_ORDER_PREPARED_QUANTITY_UPDATED'),
    ]);
    expect(content()).toContain('Job order created');
    expect(content()).toContain('Job order sent to factory');
    expect(content()).toContain('Job order factory confirmed');
    expect(content()).toContain('Job order prepared quantity updated');
    expect(content()).not.toContain('JOB ORDER CREATED');
  });

  it.each([null, [], 'stage', 42, {}, { stageName: '' }, { stageName: '   ' }, { stageName: 42 }])(
    'falls back for malformed metadata: %p',
    async (metadata) => {
      await renderPage('IN_PRODUCTION', standardStages, [audit('historical', metadata)]);
      expect(content()).toContain('Job order stage completed');
      expect(content()).not.toContain('Production stage completed —');
    },
  );

  it('preserves custom stage-name capitalization', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('custom', { stageName: 'QA Review' }),
    ]);
    expect(content()).toContain('Production stage completed — QA Review');
  });

  it('uses a safe sentence-case fallback for unknown actions', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('unknown', null, 'SOME_NEW_EVENT_CODE'),
    ]);
    expect(content()).toContain('Some new event code');
    expect(content()).not.toContain('SOME_NEW_EVENT_CODE');
  });

  it('renders each stage name for multiple completion events', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('cutting', { stageName: 'Cutting' }),
      audit('printing', { stageName: 'Printing' }),
    ]);
    expect(content()).toContain('Production stage completed — Cutting');
    expect(content()).toContain('Production stage completed — Printing');
  });

  it('renders Quality attempts, outcomes, batches, and attachments in the same history', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [
      audit('pp-fail', { attemptNumber: 1, decision: 'FAIL' }, 'PP_SAMPLE_FINALIZED'),
      audit('pp-pass', { attemptNumber: 2, decision: 'PASS' }, 'PP_SAMPLE_FINALIZED'),
      audit('ppm', { activityName: 'Size Set / Pre-Production' }, 'QUALITY_ACTIVITY_FINALIZED'),
      audit('cutting', { stageName: 'Cutting' }),
      audit(
        'final-pass',
        { activityName: 'Final Inspection', batchNumber: 1, outcome: 'PASS' },
        'FINAL_INSPECTION_BATCH_FINALIZED',
      ),
      audit(
        'attachment',
        { activityName: 'Final Inspection', batchNumber: 2, requirementKey: 'measurement_sheet' },
        'QUALITY_ACTIVITY_ATTACHMENT_ADDED',
      ),
      audit(
        'final-fail',
        { activityName: 'Final Inspection', batchNumber: 2, outcome: 'FAIL' },
        'FINAL_INSPECTION_BATCH_FINALIZED',
      ),
    ]);

    expect(content()).toContain('PP Sample attempt 1 finalized — FAIL');
    expect(content()).toContain('PP Sample attempt 2 finalized — PASS');
    expect(content()).toContain('Size Set / Pre-Production finalized');
    expect(content()).toContain('Production stage completed — Cutting');
    expect(content()).toContain('Final Inspection batch 1 finalized — PASS');
    expect(content()).toContain('Final Inspection batch 2 attachment added — Measurement sheet');
    expect(content()).toContain('Final Inspection batch 2 finalized — FAIL');
  });
});

describe('JobOrderDetailPage stage completion mutation', () => {
  it('shows only Start for a not-started Production stage', async () => {
    await renderPage('CONFIRMED_BY_FACTORY', [stage('stage-1', 'Cutting', 1, 'NOT_STARTED')]);

    expect(content()).toContain('Start Cutting');
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Complete Cutting',
      ),
    ).toBe(false);
    expect(content()).not.toContain('Completed quantity');
    expect(content()).not.toContain('Save progress');
  });

  it('keeps the current stage while pending and advances only after refreshed data', async () => {
    let readCount = 0;
    let resolvePost!: (value: unknown) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/audit')) return { data: { data: [] } };
      readCount += 1;
      const stages =
        readCount <= 1
          ? [
              stage('stage-1', 'Cutting', 1, 'IN_PROGRESS'),
              stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
            ]
          : [
              stage('stage-1', 'Cutting', 1, 'COMPLETED'),
              stage('stage-2', 'Printing', 2, 'IN_PROGRESS'),
            ];
      return { data: { data: mockJobOrder('IN_PRODUCTION', stages) } };
    });
    vi.spyOn(apiClient, 'post').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/job-orders/jo-1']}>
            <Routes>
              <Route path="/job-orders/:id" element={<JobOrderDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).toContain('Current Stage: Cutting'));

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Complete Cutting'),
    );
    expect(button).toBeDefined();
    act(() => button?.click());
    await vi.waitFor(() => expect(button?.disabled).toBe(true));
    expect(content()).toContain('Current Stage: Cutting');

    resolvePost({ data: { data: mockJobOrder('IN_PRODUCTION') } });
    await vi.waitFor(() => expect(content()).toContain('Current Stage: Printing'));
  });

  it('shows a completion error and keeps the current stage after failure', async () => {
    await renderPage('IN_PRODUCTION', [stage('stage-1', 'Cutting', 1, 'IN_PROGRESS')]);
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Stage completion failed'));
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Complete Cutting'),
    );
    act(() => button?.click());
    await vi.waitFor(() => expect(content()).toContain('Stage completion failed'));
    expect(content()).toContain('Current Stage: Cutting');
  });

  it.each([
    ['CONFIRMED_BY_FACTORY', 'NOT_STARTED'],
    ['IN_PRODUCTION', 'IN_PROGRESS'],
    ['IN_PRODUCTION', 'NOT_STARTED'],
  ] as const)(
    'shows production context without mutation controls to QA for %s/%s',
    async (status, stageStatus) => {
      authState.roles = ['QA_USER'];
      await renderPage(status, [stage('stage-1', 'Cutting', 1, stageStatus)]);

      expect(content()).toContain('Current Stage: Cutting');
      expect(content()).toContain(`Production status: ${STAGE_LABELS[stageStatus]}`);
      expect(content()).not.toContain('Complete Cutting when work for this stage has finished.');
      expect(content()).not.toContain('Start Cutting');
      expect(content()).not.toContain('Complete Cutting');
    },
  );

  it('shows completed production quantities read-only to QA', async () => {
    authState.roles = ['QA_USER'];
    await renderPage('PRODUCTION_COMPLETE');

    expect(content()).toContain('Prepared Quantity');
    expect(content()).not.toContain('Update size-wise prepared quantities');
    expect(content()).not.toContain('Save Prepared Quantity');
    expect(container.querySelector('input[aria-label^="Prepared quantity for"]')).toBeNull();
  });
});
