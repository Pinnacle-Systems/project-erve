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
import { draftOverrides, finalQualityActivity, mockJobOrder, stage, standardStages } from './job-order-detail/fixtures.js';

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

describe('ISS-005 landing-page Action Required navigation', () => {
  it('shows a factory stage action without leaving Overview until selected', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });
    const area = container.querySelector('section[aria-label="Action Required"]') as HTMLElement | null;
    expect(area).not.toBeNull();
    const start = Array.from(area!.querySelectorAll('button')).find((button) => button.textContent === 'Start Cutting');
    expect(start).toBeDefined();
    expect(getActiveTabPanel(container).textContent).toContain('Lifecycle');
    expect(getLocationSearch(container)).not.toContain('tab=production');
    act(() => (start as HTMLButtonElement).click());
    expect(getLocationSearch(container)).toContain('tab=production');
    expect(getActiveTabPanel(container).textContent).toContain('Current Stage: Cutting');
  });

  it('shows QA activity discovery only for an eligible QA_USER, navigating on click', async () => {
    authState.roles = ['QA_USER'];
    await renderJobOrderDetail(container, root, {
      status: 'IN_PRODUCTION',
      overrides: {
        qualityActivities: [finalQualityActivity({ status: 'AVAILABLE', eligible: true })],
      },
    });
    const area = container.querySelector('section[aria-label="Action Required"]') as HTMLElement;
    expect(area).not.toBeNull();
    const buttons = Array.from(area.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Start Final Inspection']);
    expect(getActiveTabPanel(container).textContent).toContain('Lifecycle');
    act(() => buttons[0]!.click());
    expect(getLocationSearch(container)).toContain('tab=quality');
  });
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
    expect(getActiveTabPanel(container).textContent).not.toContain('Seasons');
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

describe('ISS-003 Factory confirmation on each unconfirmed Job Order visit', () => {
  it('combines repeated Size records into one confirmation column without losing quantities', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: {
        ...draftOverrides,
        orderedQuantityTotal: 17,
        lines: [draftOverrides.lines[0], {
          ...draftOverrides.lines[0], id: 'line-2', orderedQuantityTotal: 7,
          sizes: [{ ...draftOverrides.lines[0]!.sizes[0], id: 'line-size-2', orderedQuantity: 7 }],
        }],
      },
    });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(Array.from(dialog.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual(['Measure', 'S', 'Total']);
    expect(Array.from(dialog.querySelectorAll('tbody input')).map((input) => (input as HTMLInputElement).value)).toEqual(['17']);
    expect(dialog.querySelector('tbody tr')?.lastElementChild?.textContent).toBe('17');
  });

  it('reviews Production Plan with ordered Size columns and one measure total', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: {
        ...draftOverrides,
        orderedQuantityTotal: 17,
        lines: [{ ...draftOverrides.lines[0], orderedQuantityTotal: 17, sizes: [
          { ...draftOverrides.lines[0]!.sizes[0], orderedQuantity: 10 },
          { ...draftOverrides.lines[0]!.sizes[0], id: 'line-size-2', sizeId: 'sz-2', sizeCode: 'M', sizeLabel: 'Medium', orderedQuantity: 7 },
        ] }],
      },
    });
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(Array.from(dialog.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual(['Measure', 'S', 'M', 'Total']);
    const rows = dialog.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Production Plan');
    expect(Array.from(rows[0]!.querySelectorAll('input')).map((input) => [input.value, input.readOnly])).toEqual([['10', true], ['7', true]]);
    expect(rows[0]!.lastElementChild?.textContent).toBe('17');
    expect(dialog.textContent?.match(/ST-1 Style One/g)).toHaveLength(1);
    expect(dialog.querySelector('ul')).toBeNull();
  });

  it('opens an actionable review dialog with source terms and requires acknowledgement before confirm', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: { ...draftOverrides, disclaimerText: 'Production terms require acknowledgement.' },
    });
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Factory confirmation required');
    expect(dialog?.textContent).toContain('Production terms require acknowledgement.');
    // ISS-085: only the dialog body may scroll; the disclaimer must not
    // create a second nested scrollbar on long commercial terms.
    expect(dialog?.className).toContain('overflow-y-auto');
    const terms = dialog?.querySelector('pre') as HTMLElement;
    expect(terms).not.toBeNull();
    expect(terms.className).not.toContain('overflow-y-auto');
    expect(terms.className).not.toContain('max-h-40');
    expect(terms.className).toContain('whitespace-pre-wrap');
    expect(dialog?.textContent).toContain('ST-1 Style One');
    expect(dialog?.textContent).toContain('10');
    const confirm = Array.from(dialog!.querySelectorAll('button')).find((b) => b.textContent === 'Confirm Job Order');
    expect(confirm?.disabled).toBe(true);
    const checkbox = dialog!.querySelector('[role="checkbox"]') as HTMLElement;
    expect(checkbox).not.toBeNull();
    act(() => checkbox.click());
    expect(confirm?.disabled).toBe(false);

    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: mockJobOrder('CONFIRMED_BY_FACTORY') },
    } as never);
    act(() => confirm!.click());
    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/job-orders/jo-1/actions/confirm');
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 1, expectedDisclaimerRevision: 0, acknowledgeDisclaimer: true,
    });
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
  });

  it('offers Production review and does not reopen during tab changes or a refetch', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, { status: 'SENT_TO_FACTORY' });
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const review = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Review in Production');
    act(() => review!.click());
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(getLocationSearch(container)).toContain('tab=production'));
    act(() => switchJobOrderTab(container, 'Overview'));
    act(() => switchJobOrderTab(container, 'Production'));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(getActiveTabPanel(container).textContent).toContain('Factory acknowledgement review');
  });

  it.each([
    ['MERCHANDISER', 'SENT_TO_FACTORY'],
    ['QA_USER', 'SENT_TO_FACTORY'],
    ['FACTORY_USER', 'CONFIRMED_BY_FACTORY'],
    ['FACTORY_USER', 'DRAFT'],
  ])('never prompts role %s with Job Order status %s', async (role, status) => {
    authState.roles = [role];
    await renderJobOrderDetail(container, root, { status });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
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

describe('ISS-041 single Job Order header', () => {
  it('places identity, operational context and actions in one header without a sticky duplicate', async () => {
    await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: draftOverrides });
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const header = container.querySelector('.job-order-header')!;
    expect(header.textContent).toContain('JO-001');
    expect(header.textContent).toContain('ST-1');
    expect(header.textContent).toContain('Send to Factory');
    expect(
      header.querySelector('[aria-label="Current Job Order operational state"]'),
    ).not.toBeNull();
    expect(container.querySelector('[style*="--app-shell-header-height"]')).toBeNull();
  });
});

describe('JobOrderDetailPage consolidated header', () => {
  it('keeps the acknowledgement-gated Confirm action in the header', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderJobOrderDetail(container, root, { status: 'SENT_TO_FACTORY' });
    const header = container.querySelector('.job-order-header')!;
    const confirm = [...header.querySelectorAll('button')].find(
      (button) => button.textContent === 'Confirm',
    )!;
    expect(confirm.disabled).toBe(true);
    expect(header.textContent).toContain('Review and acknowledge the disclaimer in Production');
  });
  it('opens the existing Send confirmation from the header', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'DRAFT',
      overrides: { disclaimerText: 'Approved terms' },
    });
    const send = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Send to Factory',
    )!;
    act(() => send.click());
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Send job order to factory?',
    );
  });
  it('shows Job Order number, factory, and status regardless of which tab is active', async () => {
    await renderJobOrderDetail(container, root, { status: 'IN_PRODUCTION', stages: standardStages });
    const sticky = container.querySelector('.job-order-header') as HTMLElement;
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
            sequence: 0,
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
            sequence: 0,
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
    expect(operational.textContent).toContain('Production: Locked');

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
  it.each([
    [{ isAxiosError: true }, 'Check your connection'],
    [{ isAxiosError: true, response: { status: 500, data: { error: { message: 'private stack trace' } } } }, 'Please try again'],
    [{ isAxiosError: true, response: { status: 400, data: {} } }, 'Please try again'],
    [{ isAxiosError: true, response: { status: 403, data: {} } }, 'permission'],
    [{ isAxiosError: true, response: { status: 409, data: { error: { code: 'STALE_VERSION' } } } }, 'Reload'],
    [{ isAxiosError: true, response: { status: 400, data: { error: { code: 'VALIDATION_ERROR', details: { issues: [{ field: 'expectedVersion', message: 'Expected a number' }] } } } } }, 'expectedVersion: Expected a number'],
  ])('shows safe feedback and preserves terms after send failure (%j)', async (error, message) => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(error);
    await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: { disclaimerText: 'Persisted commercial terms' } });
    await act(async () => (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send to Factory') as HTMLButtonElement).click());
    await act(async () => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Send') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(content(container)).toContain(message));
    expect(content(container)).not.toContain('private stack trace');
    act(() => switchJobOrderTab(container, 'Production'));
    expect((container.querySelector('#job-order-disclaimer') as HTMLTextAreaElement).value).toBe('Persisted commercial terms');
  });
  it('refreshes the Job Order and audit after successful send without changing the request contract', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: mockJobOrder('SENT_TO_FACTORY') } });
    const client = await renderJobOrderDetail(container, root, { status: 'DRAFT', overrides: { disclaimerText: 'Saved terms' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => (Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Send to Factory') as HTMLButtonElement).click());
    await act(async () => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Send') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(post).toHaveBeenCalledExactlyOnceWith('/job-orders/jo-1/actions/send-to-factory', { expectedVersion: 1 }, { headers: { 'Idempotency-Key': 'jo-1:send:1' } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['job-order', 'jo-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['job-order-audit', 'jo-1'] });
  });
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
      expect(confirm.className).toContain('bg-danger');
      await act(async () => confirm.click());

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith(
        '/job-orders/jo-1/actions/cancel',
        { expectedVersion: 1 },
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    },
  );

  it('leaves the Job Order unchanged and does not invoke mutation when dialog is cancelled', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: mockJobOrder('CANCELLED') } });
    await renderJobOrderDetail(container, root, { status: 'DRAFT' });
    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel Job Order',
    ) as HTMLButtonElement;
    act(() => trigger.click());

    const cancelAction = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    ) as HTMLButtonElement;
    expect(cancelAction).toBeDefined();
    await act(async () => cancelAction.click());

    expect(post).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

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

  it('Production tab: prepared quantity and its per-size Production Plan cell/Total read Not recorded, with no live prompt', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'PRODUCTION_COMPLETE',
      overrides: { historicalImport, factoryConfirmationStatus: 'PENDING', preparedQuantityTotal: 0, lines: draftOverrides.lines },
      initialPath: '/job-orders/jo-1?tab=production',
    });
    const panel = getActiveTabPanel(container).textContent ?? '';
    expect(panel).toContain('Not recorded — this is a historical imported Job Order; no prepared quantity was recorded.');
    expect(panel).not.toContain('Prepared quantities become available after');
    expect(panel).not.toContain('Save Prepared Quantity');
    // PR2A removed the Variance column entirely; the Production Plan's
    // read-only Prepared row now ends in a Total cell, which must also read
    // "Not recorded" rather than a numeric 0 — summing placeholder values
    // would otherwise look like a real recorded total of zero.
    const planRow = Array.from(getActiveTabPanel(container).querySelectorAll('tbody tr')).at(-1)!;
    const planCells = Array.from(planRow.querySelectorAll('td')).map((td) => td.textContent);
    expect(planCells.slice(-2)).toEqual(['Not recorded', 'Not recorded']);
  });

  it('Overview: no Confirmation Pending item and no confirmation action for a historical import', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'PRODUCTION_COMPLETE',
      overrides: { historicalImport, factoryConfirmationStatus: 'PENDING', preparedQuantityTotal: 0 },
    });
    const panel = getActiveTabPanel(container).textContent ?? '';
    expect(panel).not.toMatch(/Confirmation\s*Pending/);
    expect(panel).toContain('Not recorded (historical)');
    expect(Array.from(container.querySelectorAll('button')).some((b) => /confirm/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('live Production Plan keeps its numeric prepared value and Total, with no variance column', async () => {
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: { historicalImport: null, lines: draftOverrides.lines },
      initialPath: '/job-orders/jo-1?tab=production',
    });
    const planRow = Array.from(getActiveTabPanel(container).querySelectorAll('tbody tr')).at(-1)!;
    // The read-only Prepared cell renders as an <input readOnly>, whose
    // committed value lives in the `value` property, not textContent.
    const preparedInput = planRow.querySelector('input') as HTMLInputElement;
    expect(preparedInput.value).toBe((0).toLocaleString());
    const totalCell = planRow.querySelector('td:last-child');
    expect(totalCell?.textContent).toBe((0).toLocaleString());
  });
});

describe('ISS-003 visit and refetch boundaries', () => {
  it('keeps dismissal across an actual refetch and prompts again on a fresh mounted visit', async () => {
    authState.roles = ['FACTORY_USER'];
    const client = await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: draftOverrides,
    });
    const review = [...document.body.querySelectorAll('button')].find(
      (b) => b.textContent === 'Review in Production',
    )!;
    act(() => review.click());
    const before = vi.mocked(apiClient.get).mock.calls.length;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['job-order', 'jo-1'] });
    });
    expect(vi.mocked(apiClient.get).mock.calls.length).toBeGreaterThan(before);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(vi.mocked(apiClient.get).mock.calls.some(([url]) => url === '/job-orders/jo-1')).toBe(
      true,
    );
    act(() => root.unmount());
    root = createRoot(container);
    await renderJobOrderDetail(container, root, {
      status: 'SENT_TO_FACTORY',
      overrides: draftOverrides,
    });
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
      'Factory confirmation required',
    );
  });
  it.each(['ADMIN', 'QA_USER', 'MERCHANDISER', 'ACCOUNTANT', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR'])(
    'never offers confirmation to %s without the Factory role',
    async (role) => {
      authState.roles = [role];
      await renderJobOrderDetail(container, root, {
        status: 'SENT_TO_FACTORY',
        overrides: draftOverrides,
      });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(
        [...container.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Confirm'),
      ).toBe(false);
    },
  );
});
