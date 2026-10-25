/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QaInspectionDetail, QaInspectionSessionView, QaSizeInspectionFormView } from '@erve/types';
import { QaDetailPage } from './QaDetailPage.js';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';

vi.mock('../../auth/AuthContext.js', () => ({ useAuth: vi.fn() }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  // A read-only viewer role: QaInspectionForm renders nothing for it, so the
  // "Inspection history" panel is the only source of evidence/mutation
  // controls on the page — isolating exactly what these tests assert on.
  vi.mocked(useAuth).mockReturnValue({
    user: {
      id: 'viewer-1',
      name: 'Viewer',
      email: 'viewer@example.test',
      mobile: null,
      roles: ['SENIOR_MANAGEMENT'],
    },
    status: 'authenticated',
    logoutReason: null,
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function baseForm(overrides: Partial<QaSizeInspectionFormView> = {}): QaSizeInspectionFormView {
  return {
    id: 'form-1',
    status: 'FINALIZED',
    version: 1,
    finalizedAt: '2026-08-06T12:00:00Z',
    reopenedAt: null,
    reopenReason: null,
    jobOrderLineSizeId: 'allocation-1',
    sourceReworkTaskId: null,
    styleId: 'style-1',
    styleNumber: 'STYLE-1',
    styleName: 'Style',
    primaryImage: null,
    colour: 'Navy',
    sizeCode: 'M',
    sizeLabel: 'M',
    preparedQuantity: 10,
    sampleQuantity: 2,
    checklist: [],
    inspectionRemarks: null,
    inspectedQuantity: 10,
    acceptedQuantity: 10,
    reworkQuantity: 0,
    permanentlyRejectedQuantity: 0,
    defectCategory: null,
    otherDefectDetails: null,
    defectNotes: null,
    ...overrides,
  };
}

function baseDetail(): QaInspectionDetail {
  return {
    id: 'jo-1',
    jobOrderNumber: 'JO-001',
    factory: { id: 'factory-1', code: 'F1', name: 'Factory' },
    seasons: [{ code: 'SUMMER', displayName: 'Summer 26' }],
    status: 'QA_APPROVED',
    version: 2,
    updatedAt: '2026-08-06T10:00:00Z',
    totals: {
      prepared: 10,
      availableToInspect: 0,
      accepted: 10,
      rework: 0,
      awaitingReinspection: 0,
      permanentlyRejected: 0,
      finalApproved: 10,
    },
    lines: [
      {
        jobOrderLineSizeId: 'allocation-1',
        styleId: 'style-1',
        styleNumber: 'STYLE-1',
        styleName: 'Style',
        primaryImage: null,
        colour: 'Navy',
        sizeCode: 'M',
        sizeLabel: 'M',
        orderedQuantity: 10,
        preparedQuantity: 10,
        availableToInspect: 0,
        acceptedQuantity: 10,
        reworkQuantity: 0,
        awaitingReinspectionQuantity: 0,
        permanentlyRejectedQuantity: 0,
      },
    ],
    reworkTasks: [],
    sessions: [],
  };
}

function session(overrides: Partial<QaInspectionSessionView>): QaInspectionSessionView {
  return {
    id: 'session-1',
    cycleNumber: 1,
    status: 'FINALIZED',
    inspector: { id: 'qa-1', name: 'QA User', email: 'qa@example.test' },
    finalizedAt: '2026-08-06T12:00:00Z',
    reopenedAt: null,
    reopenReason: null,
    forms: [baseForm()],
    evidence: [],
    createdAt: '2026-08-06T10:00:00Z',
    updatedAt: '2026-08-06T12:00:00Z',
    version: 1,
    ...overrides,
  };
}

async function renderDetail(detail: QaInspectionDetail) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => ({
    data: { data: String(url).includes('/audit') ? [] : detail },
  }));
  await act(async () => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/qa/jo-1']}>
          <Routes>
            <Route path="/qa/:id" element={<QaDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

describe('QaDetailPage — PP Sample attempt history and evidence (ISS-050, ISS-012)', () => {
  it('renders a single finalized cycle without tab chrome and offers a working evidence view action', async () => {
    const detail = baseDetail();
    detail.sessions = [
      session({
        evidence: [
          {
            id: 'evidence-1',
            inspectionLineId: 'form-1',
            fileName: 'proof.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T11:00:00Z',
          },
        ],
      }),
    ];
    await renderDetail(detail);

    expect(container.textContent).toContain('Inspection history');
    expect(container.textContent).toContain('Cycle 1');
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toContain('proof.png');

    const view = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'View proof.png',
    ) as HTMLButtonElement;
    expect(view).toBeDefined();
    await act(async () => view.click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('defaults the cycle selector to the active draft cycle and keeps evidence isolated per cycle', async () => {
    const detail = baseDetail();
    detail.status = 'QA_IN_PROGRESS';
    detail.sessions = [
      session({
        id: 'session-1',
        cycleNumber: 1,
        status: 'FINALIZED',
        forms: [
          baseForm({ permanentlyRejectedQuantity: 10, acceptedQuantity: 0, defectCategory: 'FABRIC' }),
        ],
        evidence: [
          {
            id: 'evidence-cycle1',
            inspectionLineId: 'form-1',
            fileName: 'cycle1.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T11:00:00Z',
          },
        ],
      }),
      session({
        id: 'session-2',
        cycleNumber: 2,
        status: 'DRAFT',
        finalizedAt: null,
        forms: [baseForm({ id: 'form-2', status: 'DRAFT', finalizedAt: null })],
        evidence: [
          {
            id: 'evidence-cycle2',
            inspectionLineId: 'form-2',
            fileName: 'cycle2.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T13:00:00Z',
          },
        ],
        createdAt: '2026-08-06T13:00:00Z',
        updatedAt: '2026-08-06T13:00:00Z',
      }),
    ];
    await renderDetail(detail);

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.textContent).toContain('Cycle 1');
    expect(tabs[1]!.textContent).toContain('Cycle 2');
    expect(tabs[1]!.textContent).toContain('Current');
    const activeTab = () => container.querySelector('[role="tab"][data-state="active"]');
    // The active DRAFT cycle (2) is the default, not simply the first cycle.
    expect(activeTab()?.textContent).toContain('Cycle 2');
    // Both cycles' own evidence is present (never merged/hidden by selection).
    expect(container.textContent).toContain('cycle1.png');
    expect(container.textContent).toContain('cycle2.png');

    // Radix's Tabs.Trigger switches on `mousedown`, not `click` — a plain
    // synthetic click event never triggers it in jsdom.
    await act(async () =>
      tabs[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })),
    );
    expect(activeTab()?.textContent).toContain('Cycle 1');
  });

  it('never exposes upload or delete controls on historical evidence for a read-only viewer', async () => {
    const detail = baseDetail();
    detail.sessions = [
      session({
        evidence: [
          {
            id: 'evidence-1',
            inspectionLineId: 'form-1',
            fileName: 'proof.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T11:00:00Z',
          },
        ],
      }),
    ];
    await renderDetail(detail);

    const buttonLabels = Array.from(container.querySelectorAll('button')).map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    );
    expect(buttonLabels.some((label) => label?.includes('Remove'))).toBe(false);
    expect(buttonLabels.some((label) => label?.includes('Upload'))).toBe(false);
  });

  it('shows an explicit empty-evidence message for a cycle with no attachments', async () => {
    const detail = baseDetail();
    detail.sessions = [session({ evidence: [] })];
    await renderDetail(detail);
    expect(container.textContent).toContain('No evidence attached to this inspection.');
  });

  it('shows session-level evidence separately from size-level evidence without duplication or cross-cycle leakage', async () => {
    const detail = baseDetail();
    detail.status = 'QA_IN_PROGRESS';
    detail.sessions = [
      session({
        id: 'session-1',
        cycleNumber: 1,
        status: 'FINALIZED',
        evidence: [
          {
            id: 'evidence-size-1',
            inspectionLineId: 'form-1',
            fileName: 'size1.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T11:00:00Z',
          },
          {
            id: 'evidence-session-1',
            inspectionLineId: null,
            fileName: 'session1.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T11:30:00Z',
          },
        ],
      }),
      session({
        id: 'session-2',
        cycleNumber: 2,
        status: 'DRAFT',
        finalizedAt: null,
        forms: [baseForm({ id: 'form-2', status: 'DRAFT', finalizedAt: null })],
        evidence: [
          {
            id: 'evidence-session-2',
            inspectionLineId: null,
            fileName: 'session2.png',
            contentType: 'image/png',
            sizeBytes: 100,
            createdAt: '2026-08-06T13:00:00Z',
          },
        ],
        createdAt: '2026-08-06T13:00:00Z',
        updatedAt: '2026-08-06T13:00:00Z',
      }),
    ];
    await renderDetail(detail);

    const text = container.textContent ?? '';
    const occurrences = (needle: string) => text.split(needle).length - 1;
    expect(text).toContain('Cycle evidence');
    // Each filename is shown exactly once — the size-level item never
    // reappears under "Cycle evidence", and the two cycles' session-level
    // items never leak into each other's section.
    expect(occurrences('size1.png')).toBe(1);
    expect(occurrences('session1.png')).toBe(1);
    expect(occurrences('session2.png')).toBe(1);

    const view = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'View session1.png',
    ) as HTMLButtonElement;
    expect(view).toBeDefined();
    await act(async () => view.click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('QaDetailPage — operational PP Sample header cycle identity', () => {
  function ppSession(
    overrides: Partial<QaInspectionSessionView> & { decision?: 'PASS' | 'FAIL' | null },
  ): QaInspectionSessionView {
    const { decision, ...rest } = overrides;
    return session({
      processFlowPpSample: {
        executionId: `execution-${rest.id ?? 'session-1'}`,
        processFlowActivityId: 'activity-1',
        qualityFormVersionId: 'sample-v1',
        sampleQuantity: 5,
        decision: decision ?? null,
      },
      ...rest,
    });
  }

  it('identifies the latest finalized cycle in the header, not the first, for Failed Cycle 1 / Passed Cycle 2', async () => {
    const detail = baseDetail();
    detail.sessions = [
      ppSession({ id: 'session-1', cycleNumber: 1, status: 'FINALIZED', decision: 'FAIL' }),
      ppSession({
        id: 'session-2',
        cycleNumber: 2,
        status: 'FINALIZED',
        decision: 'PASS',
        forms: [baseForm({ id: 'form-2' })],
        createdAt: '2026-08-07T10:00:00Z',
        updatedAt: '2026-08-07T12:00:00Z',
      }),
    ];
    await renderDetail(detail);
    expect(container.textContent).toContain('PP Sample form · Attempt 2 · FINALIZED');
    expect(container.textContent).not.toContain('Attempt 1 ·');
  });

  it('identifies an active draft Cycle 2 as current even though Cycle 1 already finalized', async () => {
    const detail = baseDetail();
    detail.status = 'QA_IN_PROGRESS';
    detail.sessions = [
      ppSession({ id: 'session-1', cycleNumber: 1, status: 'FINALIZED', decision: 'FAIL' }),
      ppSession({
        id: 'session-2',
        cycleNumber: 2,
        status: 'DRAFT',
        finalizedAt: null,
        forms: [baseForm({ id: 'form-2', status: 'DRAFT', finalizedAt: null })],
        createdAt: '2026-08-07T10:00:00Z',
        updatedAt: '2026-08-07T10:00:00Z',
      }),
    ];
    await renderDetail(detail);
    expect(container.textContent).toContain('PP Sample form · Attempt 2 · DRAFT');
  });

  it('keeps the operational header on the active cycle while switching read-only historical tabs', async () => {
    const detail = baseDetail();
    detail.status = 'QA_IN_PROGRESS';
    detail.sessions = [
      ppSession({ id: 'session-1', cycleNumber: 1, status: 'FINALIZED', decision: 'FAIL' }),
      ppSession({
        id: 'session-2',
        cycleNumber: 2,
        status: 'DRAFT',
        finalizedAt: null,
        forms: [baseForm({ id: 'form-2', status: 'DRAFT', finalizedAt: null })],
        createdAt: '2026-08-07T10:00:00Z',
        updatedAt: '2026-08-07T10:00:00Z',
      }),
    ];
    await renderDetail(detail);
    expect(container.textContent).toContain('PP Sample form · Attempt 2 · DRAFT');

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const cycle1Tab = tabs.find((tab) => tab.textContent?.includes('Cycle 1')) as HTMLElement;
    await act(async () =>
      cycle1Tab.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
      ),
    );

    // Selecting the read-only historical Cycle 1 tab must not move the
    // operational header off the still-active Cycle 2.
    expect(container.textContent).toContain('PP Sample form · Attempt 2 · DRAFT');
    expect(
      container.querySelector('[role="tab"][data-state="active"]')?.textContent,
    ).toContain('Cycle 1');
  });
});

describe('QaDetailPage — legacy (non-PP-Sample) multi-cycle history stays fully visible', () => {
  it('preserves every legacy cycle through the new selector, with no PP-Sample UI leaking in', async () => {
    const detail = baseDetail();
    detail.sessions = [
      session({
        id: 'session-1',
        cycleNumber: 1,
        status: 'FINALIZED',
        forms: [
          baseForm({ acceptedQuantity: 6, reworkQuantity: 4, permanentlyRejectedQuantity: 0 }),
        ],
      }),
      session({
        id: 'session-2',
        cycleNumber: 2,
        status: 'FINALIZED',
        forms: [
          baseForm({
            id: 'form-2',
            acceptedQuantity: 4,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
            sourceReworkTaskId: 'rework-1',
          }),
        ],
        createdAt: '2026-08-07T10:00:00Z',
        updatedAt: '2026-08-07T12:00:00Z',
      }),
    ];
    await renderDetail(detail);

    // Nothing PP-Sample-specific (decision wording, checklist choices)
    // should appear for a legacy record.
    expect(container.textContent).not.toContain('Decision:');

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.textContent).toContain('Cycle 1');
    expect(tabs[1]!.textContent).toContain('Cycle 2');

    // Both cycles' own disposition labels remain present (forceMount keeps
    // every TabsContent panel mounted) — history was never narrowed.
    expect(container.querySelectorAll('[data-density]')).not.toHaveLength(0);
    const acceptedLabels = Array.from(container.querySelectorAll('*')).filter(
      (element) => element.textContent === 'Accepted' && element.children.length === 0,
    );
    expect(acceptedLabels.length).toBeGreaterThanOrEqual(2);

    await act(async () =>
      tabs[1]!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
      ),
    );
    expect(
      container.querySelector('[role="tab"][data-state="active"]')?.textContent,
    ).toContain('Cycle 2');
  });
});
