/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveTabPanel, renderJobOrderDetail, switchJobOrderTab } from '../test-utils.js';
import { audit, standardStages } from '../fixtures.js';

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

async function renderHistory(
  status: string,
  audits: Array<ReturnType<typeof audit>> = [],
  overrides: Record<string, unknown> = {},
) {
  await renderJobOrderDetail(container, root, { status, stages: standardStages, audits, overrides });
  act(() => switchJobOrderTab(container, 'History'));
}

describe('JobOrderHistoryTab factory acknowledgement evidence', () => {
  it('shows pending copy for a current Job Order sent to the factory but not yet acknowledged', async () => {
    await renderHistory('SENT_TO_FACTORY', [], { confirmedAt: null, confirmedBy: null, acknowledgement: null });
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Factory acknowledgement is pending');
    expect(panel.textContent).not.toContain('predates the factory acknowledgement workflow');
  });

  it('shows acknowledgement evidence once the factory has acknowledged the Job Order', async () => {
    await renderHistory('CONFIRMED_BY_FACTORY', [], {
      confirmedAt: '2026-08-10T09:00:00Z',
      confirmedBy: { id: 'factory-user-1', name: 'Factory Owner', email: 'factory@test.local' },
      acknowledgement: {
        id: 'ack-1',
        jobOrderVersion: 1,
        disclaimerRevision: 1,
        disclaimerTextSnapshot: 'Standard factory terms apply.',
        disclaimerSha256: 'abc123',
        factoryIdSnapshot: 'factory-1',
        acknowledgedBy: { id: 'factory-user-1', name: 'Factory Owner', email: 'factory@test.local' },
        acknowledgedByRole: 'FACTORY_USER',
        acknowledgedAt: '2026-08-10T09:00:00Z',
        invalidatedAt: null,
        invalidatedByUserId: null,
        invalidationReason: null,
        invalidationMetadata: null,
      },
    });
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Acknowledged by');
    expect(panel.textContent).toContain('Factory Owner');
    expect(panel.textContent).toContain('SHA-256: abc123');
    expect(panel.textContent).not.toContain('Factory acknowledgement is pending');
  });

  it('does not classify a normal confirmed Job Order awaiting acknowledgement data as legacy', async () => {
    await renderHistory('CONFIRMED_BY_FACTORY', [], { confirmedAt: null, confirmedBy: null, acknowledgement: null });
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Factory acknowledgement is pending');
    expect(panel.textContent).not.toContain('predates the factory acknowledgement workflow');
  });

  it('shows legacy copy only when a Job Order was confirmed with no acknowledgement on record', async () => {
    await renderHistory('IN_PRODUCTION', [], {
      confirmedAt: '2026-08-01T09:00:00Z',
      confirmedBy: { id: 'factory-user-1', name: 'Factory Owner', email: 'factory@test.local' },
      acknowledgement: null,
    });
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('predates the factory acknowledgement workflow');
    expect(panel.textContent).not.toContain('Factory acknowledgement is pending');
  });

  it('requires no acknowledgement while the Job Order is still a draft', async () => {
    await renderHistory('DRAFT');
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('No acknowledgement is required while this Job Order is a draft');
  });
});

describe('JobOrderHistoryTab audit history', () => {
  it('renders valid stage names while preserving actor and timestamp', async () => {
    await renderHistory('IN_PRODUCTION', [audit('cutting', { stageName: ' Cutting ' })]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Production stage completed — Cutting');
    expect(panel.textContent).toContain('Alice');
    expect(panel.textContent).toContain('31 Jul 2026');
  });

  it('renders known generic actions in sentence case', async () => {
    await renderHistory('IN_PRODUCTION', [
      audit('created', null, 'JOB_ORDER_CREATED'),
      audit('sent', null, 'JOB_ORDER_SENT_TO_FACTORY'),
      audit('confirmed', null, 'JOB_ORDER_FACTORY_CONFIRMED'),
      audit('prepared', null, 'JOB_ORDER_PREPARED_QUANTITY_UPDATED'),
    ]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Job order created');
    expect(panel.textContent).toContain('Job order sent to factory');
    expect(panel.textContent).toContain('Job order factory confirmed');
    expect(panel.textContent).toContain('Job order prepared quantity updated');
    expect(panel.textContent).not.toContain('JOB ORDER CREATED');
  });

  it.each([null, [], 'stage', 42, {}, { stageName: '' }, { stageName: '   ' }, { stageName: 42 }])(
    'falls back for malformed metadata: %p',
    async (metadata) => {
      await renderHistory('IN_PRODUCTION', [audit('historical', metadata)]);
      const panel = getActiveTabPanel(container);
      expect(panel.textContent).toContain('Job order stage completed');
      expect(panel.textContent).not.toContain('Production stage completed —');
    },
  );

  it('preserves custom stage-name capitalization', async () => {
    await renderHistory('IN_PRODUCTION', [audit('custom', { stageName: 'QA Review' })]);
    expect(getActiveTabPanel(container).textContent).toContain('Production stage completed — QA Review');
  });

  it('uses a safe sentence-case fallback for unknown actions', async () => {
    await renderHistory('IN_PRODUCTION', [audit('unknown', null, 'SOME_NEW_EVENT_CODE')]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Some new event code');
    expect(panel.textContent).not.toContain('SOME_NEW_EVENT_CODE');
  });

  it('renders each stage name for multiple completion events', async () => {
    await renderHistory('IN_PRODUCTION', [
      audit('cutting', { stageName: 'Cutting' }),
      audit('printing', { stageName: 'Printing' }),
    ]);
    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('Production stage completed — Cutting');
    expect(panel.textContent).toContain('Production stage completed — Printing');
  });

  it('renders Quality attempts, outcomes, batches, and attachments in the same history', async () => {
    await renderHistory('IN_PRODUCTION', [
      audit('pp-fail', { attemptNumber: 1, decision: 'FAIL' }, 'PP_SAMPLE_FINALIZED'),
      audit('pp-pass', { attemptNumber: 2, decision: 'PASS' }, 'PP_SAMPLE_FINALIZED'),
      audit('ppm', { activityName: 'Size Set / Pre-Production' }, 'QUALITY_ACTIVITY_FINALIZED'),
      audit('cutting', { stageName: 'Cutting' }),
      audit('final-pass', { activityName: 'Final Inspection', batchNumber: 1, outcome: 'PASS' }, 'FINAL_INSPECTION_BATCH_FINALIZED'),
      audit(
        'attachment',
        { activityName: 'Final Inspection', batchNumber: 2, requirementKey: 'measurement_sheet' },
        'QUALITY_ACTIVITY_ATTACHMENT_ADDED',
      ),
      audit('final-fail', { activityName: 'Final Inspection', batchNumber: 2, outcome: 'FAIL' }, 'FINAL_INSPECTION_BATCH_FINALIZED'),
    ]);

    const panel = getActiveTabPanel(container);
    expect(panel.textContent).toContain('PP Sample attempt 1 finalized — FAIL');
    expect(panel.textContent).toContain('PP Sample attempt 2 finalized — PASS');
    expect(panel.textContent).toContain('Size Set / Pre-Production finalized');
    expect(panel.textContent).toContain('Production stage completed — Cutting');
    expect(panel.textContent).toContain('Final Inspection batch 1 finalized — PASS');
    expect(panel.textContent).toContain('Final Inspection batch 2 attachment added — Measurement sheet');
    expect(panel.textContent).toContain('Final Inspection batch 2 finalized — FAIL');
  });
});
