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

vi.mock('../../auth/AuthContext.js', () => ({
  useOptionalAuth: () => ({ user: { roles: ['MERCHANDISER', 'FACTORY_USER'] } }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  plannedQuantity: 10,
  completedQuantity: status === 'NOT_STARTED' ? 0 : 10,
  remainingQuantity: status === 'NOT_STARTED' ? 10 : 0,
  progressPercent: status === 'NOT_STARTED' ? 0 : 100,
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

describe('ProductionStageStepper', () => {
  it('renders nothing when production stages are empty', () => {
    act(() => {
      root.render(<ProductionStageStepper stages={[]} isPreparedQuantitiesUnlocked={true} />);
    });
    expect(container.innerHTML).toBe('');
  });
});

describe('JobOrderDetailPage workflow rendering', () => {
  it('shows primary Production and concurrent Quality without duplicating Production or Lifecycle', async () => {
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
        'Prepared quantities become available after Finishing is completed.',
      );
    },
  );

  it('renders unlocked prepared quantities after production completes', async () => {
    await renderPage('PRODUCTION_COMPLETE');
    expect(content()).toContain('Cutting');
    expect(content()).toContain(
      'Update size-wise prepared quantities after production is complete.',
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
      'Prepared quantities become available after Final Inspection is completed.',
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
});
