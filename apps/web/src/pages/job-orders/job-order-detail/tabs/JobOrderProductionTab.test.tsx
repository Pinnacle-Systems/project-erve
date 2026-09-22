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
  it('shows only Start for a not-started Production stage', async () => {
    await renderProduction('CONFIRMED_BY_FACTORY', [stage('stage-1', 'Cutting', 1, 'NOT_STARTED')]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Start Cutting');
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
