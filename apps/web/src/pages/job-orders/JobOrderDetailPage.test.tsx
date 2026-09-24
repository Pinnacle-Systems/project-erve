/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { JobOrderDetailPage } from './JobOrderDetailPage.js';
import { ProductionStageStepper } from './ProductionStageStepper.js';
import {
  changeInput,
  changeTextarea,
  content,
  getActiveTabPanel,
  getLocationSearch,
  renderJobOrderDetail,
  switchJobOrderTab,
} from './job-order-detail/test-utils.js';
import { draftOverrides, mockJobOrder, stage, standardStages } from './job-order-detail/fixtures.js';

const authState = vi.hoisted(() => ({ roles: ['MERCHANDISER', 'FACTORY_USER'] }));

vi.mock('../../auth/AuthContext.js', () => ({
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

describe('ProductionStageStepper', () => {
  it('renders nothing when production stages are empty', () => {
    act(() => {
      root.render(<ProductionStageStepper stages={[]} isPreparedQuantitiesUnlocked={true} />);
    });
    expect(container.innerHTML).toBe('');
  });
});

describe('JobOrderDetailPage tab navigation', () => {
  it('shows multiline historical documentary text without an editing action even for draft status', async () => {
    const source = 'Sample: 2 Pcs\nPhoto: 3 Pcs\n\n*Source clause';
    await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: {
      historicalImport: { legacyReferenceNumber: 'SYN001', historicalBusinessDate: '2025-08-15', importedAt: '2026-09-24T00:00:00Z' },
      disclaimerText: source,
    } });
    act(() => switchJobOrderTab(container, 'Production'));
    expect(container.querySelector('#job-order-disclaimer')).toBeNull();
    expect(content(container)).not.toContain('Save disclaimer');
    const rendered = Array.from(container.querySelectorAll('pre')).find((p) => p.textContent === source);
    expect(rendered).toBeDefined();
    expect(rendered!.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(content(container)).toContain('Historical source wording; no factory acknowledgement was recorded.');
  });

  it('defaults to the Overview tab and switches active content on click', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });

    expect(getActiveTabPanel(container).textContent).toContain('Lifecycle');

    act(() => switchJobOrderTab(container, 'Production'));
    expect(getActiveTabPanel(container).textContent).toContain('Current Stage: Cutting');
    expect(getActiveTabPanel(container).textContent).not.toContain('Lifecycle');

    act(() => switchJobOrderTab(container, 'Quality'));
    expect(getActiveTabPanel(container).textContent).not.toContain('Current Stage:');

    act(() => switchJobOrderTab(container, 'History'));
    expect(getActiveTabPanel(container).textContent).toContain('Audit Log');
    expect(getActiveTabPanel(container).textContent).toContain('Seasons');
  });

  it('supports arrow-key navigation between tab triggers (Radix roving tabindex)', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });
    const overviewTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === 'Overview',
    ) as HTMLElement;
    act(() => overviewTab.focus());
    expect(document.activeElement).toBe(overviewTab);
    const productionTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent === 'Production',
    ) as HTMLElement;
    act(() => {
      overviewTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    // Radix's roving-focus-group defers the actual .focus() call via
    // setTimeout, so it lands on the next tick, not synchronously.
    await vi.waitFor(() => expect(document.activeElement).toBe(productionTab));
  });

  it('inactive tab content is force-mounted but excluded from the tab order (inert)', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });
    // Production is mounted (forceMount) even though Overview is active...
    expect(content(container)).toContain('Current Stage: Cutting');
    // ...but its panel is marked `inert`, so it isn't the active one and
    // isn't reachable by keyboard/assistive tech as current page content.
    // (Radix's own `hidden` attribute only applies when NOT force-mounted —
    // verified against the installed version, see tabs.tsx.)
    const productionPanel = Array.from(container.querySelectorAll('[role="tabpanel"]')).find((panel) =>
      panel.textContent?.includes('Current Stage: Cutting'),
    ) as HTMLElement;
    expect(productionPanel.hasAttribute('inert')).toBe(true);
    expect(productionPanel.tabIndex).toBe(-1);
    expect(getActiveTabPanel(container)).not.toBe(productionPanel);
    expect(getActiveTabPanel(container).hasAttribute('inert')).toBe(false);
  });
});

describe('JobOrderDetailPage ?tab= deep linking', () => {
  it('opens the requested tab directly from the URL', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'IN_PRODUCTION',
      stages: standardStages,
      initialPath: '/job-orders/jo-1?tab=production',
    });
    expect(getActiveTabPanel(container).textContent).toContain('Current Stage: Cutting');
  });

  it('falls back to Overview for an invalid or missing tab value', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'IN_PRODUCTION',
      stages: standardStages,
      initialPath: '/job-orders/jo-1?tab=not-a-real-tab',
    });
    expect(getActiveTabPanel(container).textContent).toContain('Lifecycle');
  });

  it('preserves an unrelated existing query parameter when switching tabs', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'IN_PRODUCTION',
      stages: standardStages,
      initialPath: '/job-orders/jo-1?from=list',
    });
    act(() => switchJobOrderTab(container, 'Production'));
    await vi.waitFor(() => expect(getLocationSearch(container)).toContain('from=list'));
    expect(getLocationSearch(container)).toContain('tab=production');
  });
});

describe('JobOrderDetailPage sticky context', () => {
  it('shows Job Order number, factory, and status regardless of which tab is active', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });
    const sticky = container.querySelector('.sticky') as HTMLElement;
    expect(sticky).not.toBeNull();
    expect(sticky.textContent).toContain('JO-001');
    expect(sticky.textContent).toContain('Test Factory');

    act(() => switchJobOrderTab(container, 'History'));
    expect(sticky.textContent).toContain('JO-001');
    expect(sticky.textContent).toContain('Test Factory');
  });
});

describe('JobOrderDetailPage state persistence across tab switches', () => {
  it('keeps an in-progress Quality form value when navigating away and back', async () => {
    authState.roles = ['QA_USER'];
    await renderJobOrderDetail(container, root, {
      status: 'IN_PRODUCTION',
      stages: standardStages,
      overrides: {
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
              executionScope: 'SIZE',
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
        lines: [
          {
            id: 'line-1',
            styleId: 'style-1',
            styleNumber: 'ST-1',
            styleName: 'Style One',
            orderedQuantityTotal: 10,
            preparedQuantityTotal: 0,
            status: 'IN_PRODUCTION',
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
      },
    });

    act(() => switchJobOrderTab(container, 'Quality'));
    const quantity = container.querySelector('#field-sample-quantity') as HTMLInputElement;
    expect(quantity).not.toBeNull();
    await act(async () => changeInput(quantity, '5'));
    expect(quantity.value).toBe('5');

    act(() => switchJobOrderTab(container, 'Overview'));
    act(() => switchJobOrderTab(container, 'Quality'));

    const quantityAfterReturn = container.querySelector('#field-sample-quantity') as HTMLInputElement;
    expect(quantityAfterReturn.value).toBe('5');
  });
});

describe('JobOrderDetailPage workflow rendering', () => {
  it('shows primary Production and concurrent Quality without duplicating Production or Lifecycle', async () => {
    const concurrentStages = [
      stage('stage-1', 'Cutting', 1, 'COMPLETED'),
      stage('stage-2', 'Printing', 2, 'COMPLETED'),
      stage('stage-3', 'Sewing', 3, 'IN_PROGRESS'),
      stage('stage-4', 'Finishing', 4, 'NOT_STARTED'),
    ];
    await renderJobOrderDetail(container, root, {
      status: 'CONFIRMED_BY_FACTORY',
      stages: concurrentStages,
      overrides: {
        operationalState: {
          lifecycleContext: { code: 'CONFIRMED_BY_FACTORY', label: 'Factory Confirmed', tone: 'pending', activityId: null, activityName: null },
          productionState: { code: 'IN_PROGRESS', label: 'Sewing In Progress', tone: 'info', activityId: 'sewing', activityName: 'Sewing' },
          qualityState: { code: 'PENDING', label: 'Inline Inspection Pending', tone: 'pending', activityId: 'inline', activityName: 'Inline Inspection' },
          primaryDisplayState: { code: 'IN_PROGRESS', label: 'Sewing In Progress', tone: 'info', activityId: 'sewing', activityName: 'Sewing' },
        },
      },
    });
    const operational = container.querySelector('[aria-label="Current Job Order operational state"]')!;
    expect(operational.textContent).toContain('Current Activity');
    expect(operational.textContent).toContain('Sewing');
    expect(operational.textContent).toContain('Quality');
    expect(operational.textContent).toContain('Inline Inspection');
    expect(operational.textContent?.match(/Sewing/g)).toHaveLength(1);
    expect(operational.textContent).not.toContain('Lifecycle');
    expect(getActiveTabPanel(container).textContent).toContain('Lifecycle');
    expect(getActiveTabPanel(container).textContent).toContain('Confirmed');

    act(() => switchJobOrderTab(container, 'Production'));
    const currentStage = container.querySelector('li[aria-current="step"]')!;
    expect(currentStage.textContent).toContain('SewingCurrent');
  });

  it('prioritizes pending pre-production Quality and presents Production as locked', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'CONFIRMED_BY_FACTORY',
      stages: standardStages,
      overrides: {
        operationalState: {
          lifecycleContext: { code: 'CONFIRMED_BY_FACTORY', label: 'Factory Confirmed', tone: 'pending', activityId: null, activityName: null },
          productionState: { code: 'LOCKED', label: 'Production Locked', tone: 'pending', activityId: null, activityName: null },
          qualityState: { code: 'PENDING', label: 'Size Set / Pre-Production Report Pending', tone: 'pending', activityId: 'quality-1', activityName: 'Size Set / Pre-Production Report' },
          primaryDisplayState: { code: 'PENDING', label: 'Size Set / Pre-Production Report Pending', tone: 'pending', activityId: 'quality-1', activityName: 'Size Set / Pre-Production Report' },
        },
        qualityActivities: [
          {
            processFlowVersionStageId: 'quality-1',
            sequence: 1,
            name: 'Size Set / Pre-Production Report',
            status: 'AVAILABLE',
            eligible: true,
            qualityForm: { id: 'form-1', code: 'PP_REPORT', name: 'Size Set / Pre-Production Report', executionScope: 'JOB_ORDER' },
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
      },
    });

    const operational = container.querySelector('[aria-label="Current Job Order operational state"]')!;
    expect(operational.textContent).toContain('Current Activity');
    expect(operational.textContent).toContain('Size Set / Pre-Production Report');
    expect(operational.textContent).toContain('Production:Locked');

    act(() => switchJobOrderTab(container, 'Production'));
    expect(getActiveTabPanel(container).textContent).toContain('Locked until pre-production Quality gates are completed.');
    const currentStage = container.querySelector('li[aria-current="step"]')!;
    expect(currentStage.textContent).toContain('CuttingCurrent');

    act(() => switchJobOrderTab(container, 'Quality'));
    expect(getActiveTabPanel(container).textContent).toContain('Quality activities');
    expect(getActiveTabPanel(container).textContent).toContain('Available');
  });
});

describe('JobOrderDetailPage Send validation (disclaimer, cross-tab)', () => {
  it('blocks send before the API call, switches to Production, and focuses the required disclaimer', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderJobOrderDetail(container, root, { status: 'DRAFT' });
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;

    act(() => send.click());

    expect(post).not.toHaveBeenCalled();
    // Production wasn't the active tab when Send was clicked — the failed
    // validation must switch to it before focusing the invalid field.
    expect(getActiveTabPanel(container).textContent).toContain('Factory commercial terms / disclaimer');

    const disclaimer = container.querySelector('#job-order-disclaimer') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(disclaimer);
    expect(disclaimer.getAttribute('aria-invalid')).toBe('true');
    expect(content(container)).toContain(
      'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.',
    );
    expect(content(container)).not.toContain('Send job order to factory?');

    await act(async () => changeTextarea(disclaimer, 'Factory terms'));
    expect(disclaimer.getAttribute('aria-invalid')).toBeNull();
  });

  it('requires an edited disclaimer to be saved before opening send confirmation', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: { disclaimerText: 'Persisted terms' } });
    act(() => switchJobOrderTab(container, 'Production'));
    const disclaimer = container.querySelector('#job-order-disclaimer') as HTMLTextAreaElement;
    await act(async () => changeTextarea(disclaimer, 'Unsaved replacement terms'));

    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;
    act(() => send.click());

    expect(post).not.toHaveBeenCalled();
    expect(content(container)).toContain('Save the disclaimer before sending this Job Order to the factory.');
    expect(document.activeElement).toBe(disclaimer);
  });

  it('maps a backend disclaimer error to actionable feedback instead of Axios text', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: {
        data: { error: { code: 'DISCLAIMER_REQUIRED', message: 'A factory commercial terms / disclaimer is required' } },
      },
    });
    await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: { disclaimerText: 'Persisted terms' } });
    const send = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send to Factory',
    ) as HTMLButtonElement;
    act(() => send.click());
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Send',
    ) as HTMLButtonElement;

    await act(async () => confirm.click());

    await vi.waitFor(() =>
      expect(content(container)).toContain(
        'Factory commercial terms / disclaimer is required before sending this Job Order to the factory.',
      ),
    );
    expect(content(container)).not.toContain('Request failed with status code 400');
  });
});

describe('JobOrderDetailPage Cancel Job Order (Correction 4)', () => {
  it.each(['DRAFT', 'SENT_TO_FACTORY', 'CONFIRMED_BY_FACTORY'])(
    'lets a Merchandiser cancel a %s job order with a confirmation dialog',
    async (status) => {
      const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: mockJobOrder('CANCELLED') } });
      await renderJobOrderDetail(container, root, { status });

      const trigger = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Cancel Job Order',
      ) as HTMLButtonElement;
      expect(trigger).toBeDefined();
      act(() => trigger.click());

      const confirm = Array.from(document.body.querySelectorAll('button')).find(
        (button) => button.textContent === 'Yes, cancel Job Order',
      ) as HTMLButtonElement;
      expect(confirm).toBeDefined();
      await act(async () => confirm.click());

      expect(post).toHaveBeenCalledWith(
        '/job-orders/jo-1/actions/cancel',
        { expectedVersion: 1 },
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    },
  );

  it('shows the consequence of cancellation before confirming', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: mockJobOrder('CANCELLED') } });
    await renderJobOrderDetail(container, root, { status: 'DRAFT' });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel Job Order',
    ) as HTMLButtonElement;
    act(() => trigger.click());

    const dialogText = document.body.textContent ?? '';
    expect(dialogText).toContain('production cannot continue');
    expect(dialogText).toContain('source Order Sheets remain locked');
    expect(dialogText).toContain('cannot be undone');
  });

  it.each(['IN_PRODUCTION', 'PRODUCTION_COMPLETE', 'CANCELLED'])(
    'does not offer cancellation once the job order is %s',
    async (status) => {
      await renderJobOrderDetail(container, root, { status });
      expect(
        Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Cancel Job Order'),
      ).toBe(false);
    },
  );

  it('hides the action from a Factory-only user', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, { status: 'DRAFT' });
    expect(
      Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Cancel Job Order'),
    ).toBe(false);
  });

  it('surfaces a server-side eligibility error', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 409',
      response: {
        data: { error: { code: 'CONFLICT', message: 'This job order can no longer be cancelled — production has already started' } },
      },
    });
    await renderJobOrderDetail(container, root, { status: 'CONFIRMED_BY_FACTORY' });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel Job Order',
    ) as HTMLButtonElement;
    act(() => trigger.click());
    const confirm = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Yes, cancel Job Order',
    ) as HTMLButtonElement;

    await act(async () => confirm.click());

    await vi.waitFor(() =>
      expect(content(container)).toContain('This job order can no longer be cancelled — production has already started'),
    );
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Job order not found" EmptyState —
// that EmptyState is reserved for a genuine no-such-record response.
describe('JobOrderDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url.endsWith('/audit')) return { data: { data: [] } };
      throw new Error('Request failed with status code 500');
    });

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

    expect(content(container)).not.toContain('Job order not found');
    expect(content(container)).toContain('Unable to load job order');
    expect(content(container)).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('JobOrderDetailPage historical import presentation', () => {
  const historicalImport = { legacyReferenceNumber: 'EI25018', historicalBusinessDate: '2025-08-15', importedAt: '2026-09-24T00:00:00Z' };

  it('Production tab: prepared quantity and per-size prepared/variance read Not recorded / Not applicable, with no live prompt', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'PRODUCTION_COMPLETE',
      overrides: { historicalImport, factoryConfirmationStatus: 'PENDING', preparedQuantityTotal: 0, lines: draftOverrides.lines },
      initialPath: '/job-orders/jo-1?tab=production',
    });
    const panel = getActiveTabPanel(container).textContent ?? '';
    expect(panel).toContain('Not recorded — this is a historical imported Job Order; no prepared quantity was recorded.');
    expect(panel).not.toContain('Prepared quantities become available after');
    expect(panel).not.toContain('Save Prepared Quantity');
    const planRow = Array.from(getActiveTabPanel(container).querySelectorAll('tbody tr')).at(-1)!;
    const planCells = Array.from(planRow.querySelectorAll('td')).map((td) => td.textContent);
    expect(planCells.slice(-2)).toEqual(['Not recorded', 'Not applicable']);
  });

  it('Overview: no Confirmation Pending item and no confirmation action for a historical import', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'PRODUCTION_COMPLETE',
      overrides: { historicalImport, factoryConfirmationStatus: 'PENDING', preparedQuantityTotal: 0 },
    });
    const panel = getActiveTabPanel(container).textContent ?? '';
    expect(panel).not.toMatch(/Confirmation\s*Pending/);
    expect(panel).toContain('Not recorded (historical)');
    expect(panel).toContain('Not applicable');
    expect(Array.from(container.querySelectorAll('button')).some((b) => /confirm/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('live Production Plan keeps its numeric prepared and variance values', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: { historicalImport: null, lines: draftOverrides.lines },
      initialPath: '/job-orders/jo-1?tab=production',
    });
    const planRow = Array.from(getActiveTabPanel(container).querySelectorAll('tbody tr')).at(-1)!;
    const planCells = Array.from(planRow.querySelectorAll('td')).map((td) => td.textContent);
    expect(planCells.slice(-2)).toEqual([(0).toLocaleString(), (-10).toLocaleString()]);
  });
});
