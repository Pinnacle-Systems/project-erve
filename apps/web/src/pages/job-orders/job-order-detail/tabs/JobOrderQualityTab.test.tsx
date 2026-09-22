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
      'Each batch allocation must be a whole number within the available size quantity.',
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

  it('surfaces a Final allocation conflict returned by the API', async () => {
    authState.roles = ['QA_USER'];
    await renderQuality('IN_PRODUCTION', { qualityActivities: [finalQualityActivity()] });
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
    const quantity = container.querySelector(
      'input[aria-label="Final batch quantity for size M"]',
    ) as HTMLInputElement;
    await act(async () => changeInput(quantity, '25'));
    const start = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Start Inspection',
    ) as HTMLButtonElement;

    await act(async () => start.click());
    await vi.waitFor(() =>
      expect(content(container)).toContain('Final batch allocation exceeds available prepared quantity'),
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
    finalQualityActivity({ status: 'IN_PROGRESS', execution: { id: 'execution-1' } });

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
      qualityActivities: [finalQualityActivity({ status: 'COMPLETED', execution: { id: 'execution-1' } })],
    });
    const link = [...container.querySelectorAll('button')].find((button) => button.textContent === 'View Inspection');
    expect(link).not.toBeUndefined();
  });
});
