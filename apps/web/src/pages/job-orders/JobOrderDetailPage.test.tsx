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

const stage = (id: string, name: string, sequence: number, status: JobOrderStage['status']): JobOrderStage => ({
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

const standardStages = [
  stage('stage-1', 'Cutting', 1, 'NOT_STARTED'),
  stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
  stage('stage-3', 'Sewing', 3, 'NOT_STARTED'),
  stage('stage-4', 'Finishing', 4, 'NOT_STARTED'),
];

const mockJobOrder = (status: string, stages: JobOrderStage[] = standardStages) => ({
  id: 'jo-1',
  jobOrderNumber: 'JO-001',
  status,
  factoryConfirmationStatus: status === 'DRAFT' || status === 'SENT_TO_FACTORY' ? 'PENDING' : 'CONFIRMED',
  orderedQuantityTotal: 10,
  preparedQuantityTotal: 0,
  version: 1,
  createdAt: '2026-07-31T10:00:00Z',
  confirmedAt: null,
  productionStartedAt: null,
  productionCompletedAt: null,
  processFlowVersion: { versionNumber: 1, processFlow: { name: 'Standard Flow' } },
  purchaseOrder: { poNumber: 'PO-001' },
  factory: { name: 'Test Factory' },
  confirmedBy: null,
  lines: [],
  stages: status === 'PRODUCTION_COMPLETE'
    ? stages.map((current) => ({ ...current, status: 'COMPLETED' as const }))
    : stages,
});

type Audit = { id: string; action: string; createdAt: string; actor: { id: string; name: string; email: string } | null; metadata: unknown };

const renderPage = async (
  status: string,
  stages: JobOrderStage[] = standardStages,
  audits: Audit[] = [],
) => {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) =>
    url.endsWith('/audit')
      ? { data: { data: audits } }
      : { data: { data: mockJobOrder(status, stages) } },
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

describe('ProductionStageStepper', () => {
  it('renders nothing when production stages are empty', () => {
    act(() => {
      root.render(<ProductionStageStepper stages={[]} isPreparedQuantitiesUnlocked={true} />);
    });
    expect(container.innerHTML).toBe('');
  });
});

describe('JobOrderDetailPage workflow rendering', () => {
  it('renders the draft notice without production controls', async () => {
    await renderPage('DRAFT');
    expect(content()).toContain('Production workflow not started');
    expect(content()).toContain('Send this job order to the factory');
    expect(content()).not.toContain('Prepared Quantities');
    expect(content()).not.toContain('Current Stage:');
  });

  it('renders the awaiting-confirmation notice without production controls', async () => {
    await renderPage('SENT_TO_FACTORY');
    expect(content()).toContain('Awaiting factory confirmation');
    expect(content()).not.toContain('Prepared Quantities');
    expect(content()).not.toContain('Current Stage:');
  });

  it.each(['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'])('renders the guided workflow for %s', async (status) => {
    await renderPage(status);
    expect(content()).toContain('Cutting');
    expect(content()).toContain('Printing');
    expect(content()).toContain('Current Stage: Cutting');
    expect(content()).toContain('Prepared quantities become available after Finishing is completed.');
  });

  it('renders unlocked prepared quantities after production completes', async () => {
    await renderPage('PRODUCTION_COMPLETE');
    expect(content()).toContain('Cutting');
    expect(content()).toContain('Update size-wise prepared quantities after production is complete.');
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
    expect(content()).toContain('Prepared quantities become available after Final Inspection is completed.');
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
    await renderPage('IN_PRODUCTION', standardStages, [audit('cutting', { stageName: ' Cutting ' })]);
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
    await renderPage('IN_PRODUCTION', standardStages, [audit('custom', { stageName: 'QA Review' })]);
    expect(content()).toContain('Production stage completed — QA Review');
  });

  it('uses a safe sentence-case fallback for unknown actions', async () => {
    await renderPage('IN_PRODUCTION', standardStages, [audit('unknown', null, 'SOME_NEW_EVENT_CODE')]);
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
});

describe('JobOrderDetailPage stage completion mutation', () => {
  it('keeps the current stage while pending and advances only after refreshed data', async () => {
    let readCount = 0;
    let resolvePost!: (value: unknown) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/audit')) return { data: { data: [] } };
      readCount += 1;
      const stages = readCount <= 1
        ? [stage('stage-1', 'Cutting', 1, 'IN_PROGRESS'), stage('stage-2', 'Printing', 2, 'NOT_STARTED')]
        : [stage('stage-1', 'Cutting', 1, 'COMPLETED'), stage('stage-2', 'Printing', 2, 'IN_PROGRESS')];
      return { data: { data: mockJobOrder('IN_PRODUCTION', stages) } };
    });
    vi.spyOn(apiClient, 'post').mockImplementation(
      () => new Promise((resolve) => { resolvePost = resolve; }),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/job-orders/jo-1']}>
            <Routes><Route path="/job-orders/:id" element={<JobOrderDetailPage />} /></Routes>
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
