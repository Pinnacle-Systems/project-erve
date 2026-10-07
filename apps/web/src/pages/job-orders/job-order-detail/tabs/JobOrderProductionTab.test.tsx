/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import { JobOrderDetailPage } from '../../JobOrderDetailPage.js';
import { STAGE_LABELS } from '../../job-order-ui.js';
import { changeInput, content, getActiveTabPanel, renderJobOrderDetail, switchJobOrderTab } from '../test-utils.js';
import { draftOverrides, mockJobOrder, stage, standardStages, styleLookup } from '../fixtures.js';

const authState = vi.hoisted(() => ({ roles: ['MERCHANDISER', 'FACTORY_USER'] }));

vi.mock('../../../../auth/AuthContext.js', () => ({
  useOptionalAuth: () => ({ user: { roles: authState.roles } }),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  authState.roles = ['MERCHANDISER', 'FACTORY_USER'];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderProduction(
  status: string,
  stages = standardStages,
  overrides: Record<string, unknown> = {},
) {
  await renderJobOrderDetail(container, root, { status, stages, overrides });
  act(() => switchJobOrderTab(container, 'Production'));
}

describe('JobOrderProductionTab workflow rendering', () => {
  it('renders the draft notice without production controls', async () => {
    await renderProduction('DRAFT');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Production workflow not started');
    expect(panel.textContent).toContain('Send this job order to the factory');
    expect(panel.textContent).not.toContain('Current Stage:');
  });

  it('renders the awaiting-confirmation notice without production controls', async () => {
    await renderProduction('SENT_TO_FACTORY');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Awaiting factory confirmation');
    expect(panel.textContent).not.toContain('Current Stage:');
  });

  it.each(['CONFIRMED_BY_FACTORY', 'IN_PRODUCTION'])('renders the guided workflow for %s', async (status) => {
    await renderProduction(status);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Cutting');
    expect(panel.textContent).toContain('Printing');
    expect(panel.textContent).toContain('Current Stage: Cutting');
    expect(panel.textContent).toContain(
      'Prepared quantities become available after Finishing satisfies the Process Flow rule.',
    );
  });

  it('renders unlocked prepared quantities after production completes', async () => {
    await renderProduction('PRODUCTION_COMPLETE');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Cutting');
    expect(panel.textContent).toContain(
      'Update the cumulative size-wise quantity prepared for Final inspection so far.',
    );
    expect(panel.textContent).not.toContain('Prepared quantities become available after');
  });

  it('renders custom stages in server-provided order without hard-coded names', async () => {
    const customStages = [
      stage('custom-1', 'Fabric Preparation', 1, 'NOT_STARTED'),
      stage('custom-2', 'Embroidery', 2, 'NOT_STARTED'),
      stage('custom-3', 'Final Inspection', 3, 'NOT_STARTED'),
    ];
    await renderProduction('IN_PRODUCTION', customStages);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Fabric Preparation');
    expect(panel.textContent).toContain('Embroidery');
    expect(panel.textContent).toContain('Final Inspection');
    expect(panel.textContent).toContain('Current Stage: Fabric Preparation');
    expect(panel.textContent).not.toContain('Cutting');
  });
});

describe('JobOrderProductionTab stage completion mutation', () => {
  it('shows only Start for a not-started Production stage with primary styling', async () => {
    await renderProduction('CONFIRMED_BY_FACTORY', [stage('stage-1', 'Cutting', 1, 'NOT_STARTED')]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Start Cutting');
    const startButton = Array.from(panel.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Start Cutting',
    );
    expect(startButton).toBeDefined();
    expect(startButton?.className).toContain('bg-primary');
    expect(
      Array.from(panel.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Complete Cutting'),
    ).toBe(false);
  });

  it('keeps the current stage while pending and advances only after refreshed data', async () => {
    let readCount = 0;
    let resolvePost!: (value: unknown) => void;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/audit')) return { data: { data: [] } };
      readCount += 1;
      const stages =
        readCount <= 1
          ? [stage('stage-1', 'Cutting', 1, 'IN_PROGRESS'), stage('stage-2', 'Printing', 2, 'NOT_STARTED')]
          : [stage('stage-1', 'Cutting', 1, 'COMPLETED'), stage('stage-2', 'Printing', 2, 'IN_PROGRESS')];
      return { data: { data: mockJobOrder('IN_PRODUCTION', stages) } };
    });
    vi.spyOn(apiClient, 'post').mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));

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
    await vi.waitFor(() => expect(content(container)).not.toContain('Loading job order'));
    act(() => switchJobOrderTab(container, 'Production'));
    await vi.waitFor(() => expect(content(container)).toContain('Current Stage: Cutting'));

    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Complete Cutting'),
    );
    expect(button).toBeDefined();
    act(() => button?.click());
    await vi.waitFor(() => expect(button?.disabled).toBe(true));
    expect(content(container)).toContain('Current Stage: Cutting');

    resolvePost({ data: { data: mockJobOrder('IN_PRODUCTION') } });
    await vi.waitFor(() => expect(content(container)).toContain('Current Stage: Printing'));
  });

  it('shows a completion error and keeps the current stage after failure', async () => {
    await renderProduction('IN_PRODUCTION', [stage('stage-1', 'Cutting', 1, 'IN_PROGRESS')]);
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Stage completion failed'));
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes('Complete Cutting'),
    );
    act(() => button?.click());
    await vi.waitFor(() => expect(content(container)).toContain('Stage completion failed'));
    expect(content(container)).toContain('Current Stage: Cutting');
  });

  it.each([
    ['CONFIRMED_BY_FACTORY', 'NOT_STARTED'],
    ['IN_PRODUCTION', 'IN_PROGRESS'],
    ['IN_PRODUCTION', 'NOT_STARTED'],
  ] as const)('shows production context without mutation controls to QA for %s/%s', async (status, stageStatus) => {
    authState.roles = ['QA_USER'];
    await renderProduction(status, [stage('stage-1', 'Cutting', 1, stageStatus)]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Current Stage: Cutting');
    expect(panel.textContent).toContain(`Production status: ${STAGE_LABELS[stageStatus]}`);
    expect(panel.textContent).not.toContain('Complete Cutting when work for this stage has finished.');
    expect(panel.textContent).not.toContain('Start Cutting');
    expect(panel.textContent).not.toContain('Complete Cutting');
  });

  it('shows completed production quantities read-only to QA', async () => {
    authState.roles = ['QA_USER'];
    await renderProduction('PRODUCTION_COMPLETE');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Prepared Quantity');
    expect(panel.textContent).not.toContain('Save Prepared Quantity');
    expect(panel.querySelector('input[aria-label^="Prepared quantity for"]')).toBeNull();
  });
});

describe('JobOrderProductionTab manual Production Complete (Correction 3)', () => {
  it('lets a Merchandiser mark an in-production Job Order Production Complete', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: mockJobOrder('PRODUCTION_COMPLETE') } });
    await renderProduction('IN_PRODUCTION');

    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mark Production Complete',
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    expect(trigger.disabled).toBe(false);
    act(() => trigger.click());

    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm',
    ) as HTMLButtonElement;
    expect(confirm).toBeDefined();
    await act(async () => confirm.click());

    expect(post).toHaveBeenCalledWith(
      '/job-orders/jo-1/actions/mark-production-complete',
      { expectedVersion: 1 },
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('disables the action while a production stage is in progress', async () => {
    await renderProduction('IN_PRODUCTION', [
      stage('stage-1', 'Cutting', 1, 'IN_PROGRESS'),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);

    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mark Production Complete',
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    expect(trigger.disabled).toBe(true);
    expect(content(container)).toContain(
      'Stop or complete the in-progress production stage before marking Production Complete.',
    );
  });

  it('hides the action from a Factory-only user', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderProduction('IN_PRODUCTION');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Production Completion');
    expect(
      Array.from(panel.querySelectorAll('button')).some((button) => button.textContent === 'Mark Production Complete'),
    ).toBe(false);
  });

  it('does not show the action once already Production Complete', async () => {
    await renderProduction('PRODUCTION_COMPLETE');
    expect(content(container)).not.toContain('Mark Production Complete');
  });

  it('surfaces a server-side eligibility error', async () => {
    await renderProduction('IN_PRODUCTION');
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: {
        data: {
          error: {
            code: 'CONFLICT',
            message: 'A production stage is currently in progress; stop or complete it before marking Production Complete',
          },
        },
      },
    });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mark Production Complete',
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Confirm',
    ) as HTMLButtonElement;

    await act(async () => confirm.click());

    await vi.waitFor(() =>
      expect(content(container)).toContain(
        'A production stage is currently in progress; stop or complete it before marking Production Complete',
      ),
    );
  });
});

describe('JobOrderProductionTab Undo completed stage (DEMO-010)', () => {
  // The shared `stage()` fixture stamps a fixed, long-past completedAt
  // ('2026-07-31T10:00:00Z') — useful on its own for exercising the
  // Merchandiser 24-hour cutoff against the real clock without faking time,
  // but tests that need a stage completed "just now" build their own via
  // this helper instead.
  function freshlyCompletedStage(id: string, name: string, sequence: number) {
    return { ...stage(id, name, sequence, 'COMPLETED'), completedAt: new Date().toISOString() };
  }

  function findDialogInput(label: string): HTMLInputElement {
    const match = Array.from(document.body.querySelectorAll('label')).find(
      (candidate) => candidate.textContent === label,
    );
    if (!match) throw new Error(`No dialog field labeled "${label}"`);
    const inputId = match.getAttribute('for');
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input) throw new Error(`No input for label "${label}"`);
    return input as HTMLInputElement;
  }

  it('hides Undo from a Factory-only user even when eligible otherwise', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderProduction('IN_PRODUCTION', [
      freshlyCompletedStage('stage-1', 'Cutting', 1),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);
    expect(content(container)).not.toContain('Undo completed stage');
    expect(
      Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('Undo')),
    ).toBe(false);
  });

  it('shows Undo to Merchandiser within 24 hours when the next stage has not started', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderProduction('IN_PRODUCTION', [
      freshlyCompletedStage('stage-1', 'Cutting', 1),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Undo completed stage');
    expect(
      Array.from(panel.querySelectorAll('button')).some((button) => button.textContent === 'Undo Cutting'),
    ).toBe(true);
  });

  it('hides Undo from Merchandiser once more than 24 hours have passed', async () => {
    authState.roles = ['MERCHANDISER'];
    // Default `stage()` completedAt is long in the past relative to the
    // real clock this test runs under.
    await renderProduction('IN_PRODUCTION', [
      stage('stage-1', 'Cutting', 1, 'COMPLETED'),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);
    expect(content(container)).not.toContain('Undo completed stage');
  });

  it('still shows Undo to Admin after the Merchandiser 24-hour window', async () => {
    authState.roles = ['ADMIN'];
    await renderProduction('IN_PRODUCTION', [
      stage('stage-1', 'Cutting', 1, 'COMPLETED'),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Undo completed stage');
  });

  it('hides Undo once the next stage has started', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderProduction('IN_PRODUCTION', [
      freshlyCompletedStage('stage-1', 'Cutting', 1),
      stage('stage-2', 'Printing', 2, 'IN_PROGRESS'),
    ]);
    expect(content(container)).not.toContain('Undo completed stage');
  });

  it('requires a reason before the Undo dialog can be submitted, then posts to undo-stage', async () => {
    authState.roles = ['ADMIN'];
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: mockJobOrder('IN_PRODUCTION', [
        stage('stage-1', 'Cutting', 1, 'IN_PROGRESS'),
        stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
      ]) },
    });
    await renderProduction('IN_PRODUCTION', [
      freshlyCompletedStage('stage-1', 'Cutting', 1),
      stage('stage-2', 'Printing', 2, 'NOT_STARTED'),
    ]);

    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Undo Cutting',
    ) as HTMLButtonElement;
    expect(trigger).toBeDefined();
    act(() => trigger.click());

    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Undo stage',
    ) as HTMLButtonElement;
    expect(confirm).toBeDefined();
    expect(confirm.disabled).toBe(true);

    const reasonInput = findDialogInput('Reason');
    changeInput(reasonInput, 'Cutting defect found');
    expect(confirm.disabled).toBe(false);

    await act(async () => confirm.click());

    expect(post).toHaveBeenCalledWith(
      '/job-orders/jo-1/actions/undo-stage',
      { stageStatusId: 'stage-1', expectedVersion: 1, reason: 'Cutting defect found' },
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });
});

describe('JobOrderProductionTab Production Plan (Phase 2.1)', () => {
  it('renders an editable Production Plan for a DRAFT job order and saves via PATCH .../production-plan', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'DRAFT',
      stages: standardStages,
      overrides: draftOverrides,
      extraGetResponses: { '/styles/style-1': styleLookup },
    });
    act(() => switchJobOrderTab(container, 'Production'));

    const quantityInput = await vi.waitFor(() => {
      const input = container.querySelector<HTMLInputElement>('[aria-label="Production quantity for Small"]');
      expect(input).not.toBeNull();
      return input!;
    });
    expect(quantityInput.value).toBe('10');
    changeInput(quantityInput, '7');

    vi.spyOn(apiClient, 'patch').mockResolvedValue({
      data: { data: mockJobOrder('DRAFT', standardStages, draftOverrides) },
    } as never);

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Production Plan',
    )!;
    act(() => saveButton.click());
    await vi.waitFor(() => expect(apiClient.patch).toHaveBeenCalled());

    const [url, body] = vi.mocked(apiClient.patch).mock.calls[0]!;
    expect(url).toBe('/job-orders/jo-1/production-plan');
    expect(body).toMatchObject({ sizes: [{ sizeId: 'sz-1', quantity: 7 }], expectedVersion: 1 });
  });

  it('does not render an editable Production Plan once the job order leaves DRAFT', async () => {
    await renderProduction('SENT_TO_FACTORY', standardStages, draftOverrides);
    const panel = getActiveTabPanel(container);
    expect(panel.querySelector('[aria-label="Production quantity for Small"]')).toBeNull();
    expect(
      Array.from(panel.querySelectorAll('button')).some((button) => button.textContent === 'Save Production Plan'),
    ).toBe(false);
  });
});
