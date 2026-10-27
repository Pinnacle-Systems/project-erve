/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../../../lib/api-client.js';
import { changeInput, content, getActiveTabPanel, renderJobOrderDetail, switchJobOrderTab } from '../test-utils.js';
import { finalQualityActivity, standardStages } from '../fixtures.js';

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

async function renderQuality(status: string, overrides: Record<string, unknown> = {}) {
  await renderJobOrderDetail(container, root, { status, stages: standardStages, overrides });
  act(() => switchJobOrderTab(container, 'Quality'));
}

describe('JobOrderQualityTab PP Sample start alignment', () => {
  it('aligns Sample Size, Sample Quantity and Start Inspection in a responsive row', async () => {
    authState.roles = ['QA_USER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({
          name: 'PP Sample',
          qualityForm: { id: 'pp-form', code: 'PP_SAMPLE', name: 'PP Sample Report', executionScope: 'SIZE' },
          executionMultiplicity: 'SINGLE',
          executionMode: 'SEQUENTIAL_GATE',
          coverage: null,
        }),
      ],
    });
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    );
    expect(start).toBeDefined();
    const controls = start!.parentElement!;
    expect(controls.className).toContain('grid-cols-1');
    expect(controls.className).toContain('items-end');
    expect(controls.textContent).toContain('Sample Size');
    expect(controls.textContent).toContain('Sample Quantity');
  });
});

describe('JobOrderQualityTab Final batch allocation', () => {
  it('validates a Final size allocation, clears the error, and starts once', async () => {
    authState.roles = ['QA_USER'];
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'execution-1', jobOrderId: 'jo-1', ppSample: null } },
    });
    await renderQuality('IN_PRODUCTION', { qualityActivities: [finalQualityActivity()] });
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size M"]',
    ) as HTMLInputElement;

    act(() => start.click());

    expect(post).not.toHaveBeenCalled();
    expect(content(container)).toContain('Allocate at least one prepared unit to this Final batch.');

    await act(async () => changeInput(quantity, '0'));
    act(() => start.click());
    expect(post).not.toHaveBeenCalled();

    await act(async () => changeInput(quantity, '-1'));
    act(() => start.click());
    expect(post).not.toHaveBeenCalled();

    await act(async () => changeInput(quantity, '1.5'));
    act(() => start.click());
    expect(content(container)).toContain(
      'M: Enter a non-negative whole number for This batch.',
    );

    await act(async () => changeInput(quantity, '25'));
    expect(content(container)).not.toContain('Allocate at least one prepared unit');

    await act(async () => {
      start.click();
      start.click();
    });
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/job-orders/jo-1/quality-activities/final-quality/executions', {
      allocations: [{ jobOrderLineSizeId: 'line-size-m', quantity: 25 }],
    });
  });

  it('identifies an over-allocated Size and its remaining available quantity', async () => {
    authState.roles = ['QA_USER'];
    const final = finalQualityActivity();
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { id: 'execution-8y', jobOrderId: 'jo-1', ppSample: null } },
    });
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({
        coverage: {
          ...final.coverage,
          availableBySize: [
            {
              jobOrderLineSizeId: 'line-size-8y',
              sizeCode: '8Y',
              sizeLabel: '8Y',
              preparedQuantity: 10,
              allocatedQuantity: 7,
              availableQuantity: 3,
            },
          ],
        },
      })],
    });
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size 8Y"]',
    ) as HTMLInputElement;
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;

    await act(async () => changeInput(quantity, '5'));
    act(() => start.click());
    expect(content(container)).toContain('8Y: You entered 5; only 3 available.');
    expect(post).not.toHaveBeenCalled();

    await act(async () => changeInput(quantity, '3'));
    await act(async () => start.click());
    expect(post).toHaveBeenCalledWith(
      '/job-orders/jo-1/quality-activities/final-quality/executions',
      { allocations: [{ jobOrderLineSizeId: 'line-size-8y', quantity: 3 }] },
    );
  });

  it('surfaces a Final allocation conflict returned by the API', async () => {
    authState.roles = ['QA_USER'];
    await renderQuality('IN_PRODUCTION', { qualityActivities: [finalQualityActivity()] });
    vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Final batch allocation for size line-size-m exceeds available prepared quantity 2',
          },
        },
      },
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
      expect(content(container)).toContain('M: You entered 25; only 2 available. Reload to review the latest quantities.'),
    );

    expect(quantity.value).toBe('25');
  });
});

describe('JobOrderQualityTab Reinspection Handoff', () => {
  const reworkTaskFixture = {
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
  };

  // NEW-AUTH-003: there is no ERVE-managed Factory rework lifecycle — QA (not
  // Factory) acknowledges/readies rework in ERVE once the physical correction
  // is confirmed offline.
  it('shows size-level corrections inside the original Job Order and performs QA actions', async () => {
    authState.roles = ['QA_USER'];
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: {} } });
    await renderQuality('REWORK_REQUIRED', { reworkTasks: [reworkTaskFixture] });

    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Open corrections');
    expect(panel.textContent).toContain('JO-001 · ST-101 Oxford Shirt · Size Medium');
    expect(panel.textContent).toContain('Loose cuff seam');
    expect(panel.textContent).toContain('Repair the cuff and present all four units.');
    expect(panel.textContent).not.toContain('rework-1');

    const acknowledge = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Acknowledge Correction',
    ) as HTMLButtonElement;
    await act(async () => acknowledge.click());
    expect(post).toHaveBeenCalledWith(
      '/qa/rework/rework-1/acknowledge',
      { expectedVersion: 1, notes: null },
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('shows FACTORY_USER read-only correction details with no reinspection-handoff controls', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderQuality('REWORK_REQUIRED', { reworkTasks: [reworkTaskFixture] });

    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Open corrections');
    expect(panel.textContent).toContain('Loose cuff seam');
    const buttons = Array.from(panel.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).not.toContain('Acknowledge Correction');
    expect(buttons).not.toContain('Save notes');
    expect(buttons).not.toContain('Mark Ready for Reinspection');
    const notes = panel.querySelector('textarea') as HTMLTextAreaElement;
    expect(notes.readOnly).toBe(true);
  });
});

// UXAUTH-011: the View/Continue Inspection cross-link navigates to either
// /qa/:jobOrderId (SIZE scope) or /quality-executions/:executionId (JOB_ORDER
// scope) — both routes share the exact same allowed-role set (QA_VIEW_ROLES:
// ADMIN, MERCHANDISER, SENIOR_MANAGEMENT, QA_USER). FACTORY_USER can view
// this Job Order and its Quality activities status/history, but is in
// neither route's guard, so the button itself must not render for it.
describe('JobOrderQualityTab QA/inspection cross-link (UXAUTH-011)', () => {
  const activityWithExecution = () =>
    finalQualityActivity({ status: 'IN_PROGRESS', execution: { id: 'execution-1', status: 'DRAFT' } });

  it('does not render the View/Continue Inspection cross-link for FACTORY_USER', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderQuality('IN_PRODUCTION', { qualityActivities: [activityWithExecution()] });
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Final Inspection');
    const link = [...panel.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue Inspection' || button.textContent === 'View Inspection',
    );
    expect(link).toBeUndefined();
  });

  it('still renders Continue Inspection for MERCHANDISER (an authorized QA_VIEW_ROLES member)', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', { qualityActivities: [activityWithExecution()] });
    const link = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Continue Inspection',
    );
    expect(link).not.toBeUndefined();
  });

  it('still renders View Inspection for QA_USER once the activity is COMPLETED', async () => {
    authState.roles = ['QA_USER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ status: 'COMPLETED', execution: { id: 'execution-1', status: 'FINALIZED' } }),
      ],
    });
    const link = [...container.querySelectorAll('button')].find((button) => button.textContent === 'View Inspection');
    expect(link).not.toBeUndefined();
  });

  // DEMO-013: for a BATCHED activity (Final Inspection) the activity-level
  // badge can still read IN_PROGRESS while coverage spans multiple batches,
  // even though the specific latest-attempt execution the button targets is
  // already FINALIZED — the label (and read-only-ness of what opens) must
  // follow the targeted execution, not the activity badge.
  it('renders View Inspection — not Continue — when the targeted execution is already FINALIZED, even if the activity badge still reads IN_PROGRESS', async () => {
    authState.roles = ['QA_USER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ status: 'IN_PROGRESS', execution: { id: 'execution-1', status: 'FINALIZED' } }),
      ],
    });
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toContain('View Inspection');
    expect(buttons).not.toContain('Continue Inspection');
  });
});

// ISS-050: Inline QA's recorded attempts were previously invisible here —
// the discoverability table was gated to PP Sample (SIZE scope) only, even
// though the same executionHistory data already existed for Inline QA.
describe('JobOrderQualityTab ISS-050 non-batched attempt history discoverability', () => {
  const inlineHistoryEntry = (id: string, attemptNumber: number, outcome: 'PASS' | 'FAIL') => ({
    id,
    attemptNumber,
    batchNumber: 1,
    inspectedQuantity: null,
    sampleJobOrderLineSizeId: null,
    sampleQuantity: null,
    sampleSizeCode: null,
    sampleSizeLabel: null,
    ppSampleSessionId: null,
    ppSampleFormId: null,
    status: 'FINALIZED',
    outcome,
    startedBy: { id: 'u1', name: 'QA One', email: 'qa1@test.local' },
    finalizedBy: { id: 'u1', name: 'QA One', email: 'qa1@test.local' },
    startedAt: '',
    finalizedAt: '',
  });
  const inlineActivity = (overrides: Record<string, unknown> = {}) =>
    finalQualityActivity({
      processFlowVersionStageId: 'inline-quality',
      name: 'Inline Inspection',
      qualityForm: { id: 'inline-form', code: 'INLINE', name: 'Inline Inspection Report', executionScope: 'JOB_ORDER' },
      executionMultiplicity: 'SINGLE',
      executionMode: 'IN_PROCESS',
      execution: {
        id: 'exec-2',
        attemptNumber: 2,
        batchNumber: 1,
        inspectedQuantity: null,
        status: 'FINALIZED',
        version: 1,
        outcome: 'PASS',
        startedAt: '',
        finalizedAt: '',
      },
      executionHistory: [inlineHistoryEntry('exec-1', 1, 'FAIL'), inlineHistoryEntry('exec-2', 2, 'PASS')],
      ...overrides,
    });

  it('lists every recorded Inline QA attempt and navigates to the selected one on click', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', { qualityActivities: [inlineActivity()] });
    expect(content(container)).toContain('Attempt');
    const row = [...container.querySelectorAll('tr')].find(
      (tr) => tr.textContent?.includes('1') && tr.textContent?.includes('FAIL'),
    )!;
    expect(row).not.toBeUndefined();
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const probe = container.querySelector('[data-testid="location-probe"]');
    expect(probe?.textContent).toContain('/quality-executions/exec-1');
  });

  it('never shows attempt-history rows as clickable for PP Sample (SIZE scope) — that navigation stays out of this PR', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        inlineActivity({
          name: 'PP Sample',
          qualityForm: { id: 'pp-form', code: 'PP_SAMPLE', name: 'PP Sample Report', executionScope: 'SIZE' },
        }),
      ],
    });
    const row = [...container.querySelectorAll('tr')].find(
      (tr) => tr.textContent?.includes('1') && tr.textContent?.includes('FAIL'),
    )!;
    expect(row).not.toBeUndefined();
    act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const probe = container.querySelector('[data-testid="location-probe"]');
    expect(probe?.textContent).not.toContain('/quality-executions/');
  });

  it('does not render the attempt-history table for a BATCHED checkpoint (Final Inspection uses its own batch navigation)', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ executionHistory: [inlineHistoryEntry('final-exec-1', 1, 'PASS')] }),
      ],
    });
    expect(content(container)).not.toContain('Attempt 1');
  });
});

// ISS-048 final correction: a Job Order whose every physical Final batch
// was cancelled before any inspection started has no active execution, so
// without a distinct entry point there would be no way in at all to the
// history selector on /quality-executions/:id.
describe('JobOrderQualityTab ISS-048 cancelled-only history entry point', () => {
  it('offers a distinct, read-only history entry point for an authorized role when every batch is cancelled', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ execution: null, historyEntryExecutionId: 'cancelled-exec-1' }),
      ],
    });
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'View cancelled batch history',
    );
    expect(button).not.toBeUndefined();
    act(() => button!.click());
    const probe = container.querySelector('[data-testid="location-probe"]');
    expect(probe?.textContent).toContain('/quality-executions/cancelled-exec-1');
  });

  it('does not offer the history entry point to an unauthorized FACTORY_USER', async () => {
    authState.roles = ['FACTORY_USER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({ execution: null, historyEntryExecutionId: 'cancelled-exec-1' }),
      ],
    });
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'View cancelled batch history',
    );
    expect(button).toBeUndefined();
  });

  it('never shows the cancelled-history entry point while an active execution exists, even if one happens to be set', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [
        finalQualityActivity({
          execution: { id: 'active-exec-1', status: 'FINALIZED' },
          historyEntryExecutionId: 'cancelled-exec-1',
        }),
      ],
    });
    const historyButton = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'View cancelled batch history',
    );
    expect(historyButton).toBeUndefined();
    const viewButton = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'View Inspection',
    );
    expect(viewButton).not.toBeUndefined();
  });

  it('offers neither button when there is no execution and no history at all', async () => {
    authState.roles = ['MERCHANDISER'];
    await renderQuality('IN_PRODUCTION', {
      qualityActivities: [finalQualityActivity({ execution: null, status: 'NOT_AVAILABLE', eligible: false })],
    });
    const buttons = [...container.querySelectorAll('button')].map((item) => item.textContent);
    expect(buttons).not.toContain('View cancelled batch history');
    expect(buttons).not.toContain('View Inspection');
    expect(buttons).not.toContain('Continue Inspection');
  });
});
