/** @vitest-environment jsdom */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck -- concise DOM fixture setup deliberately indexes known fixture entries.
import { describe, expect, it } from 'vitest';
import type { QaInspectionDetail, QaSizeInspectionFormView, Role } from '@erve/types';
import { QA_CHECKLIST_ITEMS } from '@erve/types';
import { draftFrom, validateDraft } from './QaInspectionPage.js';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api-client.js', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), request: vi.fn() },
}));
vi.mock('../../auth/AuthContext.js', () => ({ useAuth: vi.fn() }));
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { QaInspectionPage } from './QaInspectionPage.js';

function form(id: string, sizeLabel: string, version = 1): QaSizeInspectionFormView {
  return {
    id,
    status: 'DRAFT',
    version,
    finalizedAt: null,
    reopenedAt: null,
    reopenReason: null,
    jobOrderLineSizeId: `line-${id}`,
    sourceReworkTaskId: null,
    styleNumber: 'STYLE',
    styleName: 'Style',
    colour: null,
    sizeCode: sizeLabel,
    sizeLabel,
    preparedQuantity: 10,
    sampleQuantity: 2,
    checklist: QA_CHECKLIST_ITEMS.map((item) => ({
      itemCode: item.code,
      status: 'YES',
      remarks: `${sizeLabel} remark`,
    })),
    inspectionRemarks: `${sizeLabel} inspection`,
    inspectedQuantity: 4,
    acceptedQuantity: 3,
    reworkQuantity: 1,
    permanentlyRejectedQuantity: 0,
    defectCategory: 'STITCHING',
    otherDefectDetails: null,
    defectNotes: `${sizeLabel} defect`,
  };
}

describe('mobile QA form-scoped workflow', () => {
  it('keeps a three-size session draft isolated by form id', () => {
    const [small, medium, large] = [form('a', 'S'), form('b', 'M'), form('c', 'L')];
    const drafts = { a: draftFrom(small), b: draftFrom(medium), c: draftFrom(large) };
    drafts.a.accepted = '7';
    drafts.b.sampleQuantity = '5';
    drafts.c.checklist[QA_CHECKLIST_ITEMS[0]!.code]!.remarks = 'L only';
    expect(drafts.a.accepted).toBe('7');
    expect(drafts.b.accepted).toBe('3');
    expect(drafts.b.sampleQuantity).toBe('5');
    expect(drafts.a.sampleQuantity).toBe('2');
    expect(drafts.c.checklist[QA_CHECKLIST_ITEMS[0]!.code]!.remarks).toBe('L only');
    expect(drafts.a.checklist[QA_CHECKLIST_ITEMS[0]!.code]!.remarks).toBe('S remark');
  });

  it('blocks impossible quantities, fractions, blank OTHER, and rejected finalization without own evidence', () => {
    const draft = draftFrom(form('a', 'S'));
    draft.accepted = '8';
    draft.rework = '3';
    draft.rejected = '0';
    expect(validateDraft(draft, 10, false, 0).quantities).toContain('cannot exceed');
    draft.accepted = '1.5';
    expect(validateDraft(draft, 10, false, 0).quantities).toContain('whole');
    draft.accepted = '3';
    draft.rework = '0';
    draft.rejected = '1';
    draft.category = 'OTHER';
    draft.other = '  ';
    const errors = validateDraft(draft, 10, true, 0);
    expect(errors.other).toContain('Describe');
    expect(errors.evidence).toContain('this size');
  });
});

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof detail>;
function detail(
  forms = [form('form-s', 'S'), form('form-m', 'M', 4), form('form-l', 'L')],
  evidence: Array<{
    id: string;
    inspectionLineId: string | null;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
  }> = [],
): QaInspectionDetail {
  return {
    id: 'job-1',
    version: 3,
    updatedAt: '2026-01-01',
    jobOrderNumber: 'JO-1',
    purchaseOrderNumber: 'PO-1',
    factory: { id: 'factory', code: 'F', name: 'Factory' },
    status: 'QA_IN_PROGRESS',
    totals: {
      prepared: 30,
      availableToInspect: 30,
      accepted: 0,
      rework: 0,
      awaitingReinspection: 0,
      permanentlyRejected: 0,
      finalApproved: 0,
    },
    distributor: null,
    seasons: [],
    lines: forms.map((item) => ({
      jobOrderLineSizeId: item.jobOrderLineSizeId,
      styleNumber: item.styleNumber,
      styleName: item.styleName,
      colour: item.colour,
      sizeCode: item.sizeCode,
      sizeLabel: item.sizeLabel,
      orderedQuantity: 10,
      preparedQuantity: 10,
      availableToInspect: 10,
      acceptedQuantity: 0,
      reworkQuantity: 0,
      awaitingReinspectionQuantity: 0,
      permanentlyRejectedQuantity: 0,
    })),
    sessions: [
      {
        id: 'session-1',
        cycleNumber: 1,
        status: 'DRAFT',
        version: 1,
        inspector: { id: 'qa', name: 'QA', email: 'qa@test' },
        finalizedAt: null,
        reopenedAt: null,
        reopenReason: null,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        forms,
        evidence,
      },
    ],
    reworkTasks: [],
  };
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
async function renderPage(data = detail(), roles: Role[] = ['QA_USER']) {
  latest = clone(data);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'user', name: 'User', email: 'u@test', mobile: null, roles },
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
    retrySession: vi.fn(),
  });
  vi.mocked(apiClient.get).mockImplementation(async () => ({
    data: { success: true, data: latest },
  }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/qa/job-1'] },
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/qa/:id', element: createElement(QaInspectionPage) }),
          ),
        ),
      ),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function button(text: string) {
  const found = [...container.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found as HTMLButtonElement;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function change(label: string, value: string) {
  const input = container.querySelector(`[aria-label="${label}"]`) as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (!input) throw new Error(`Missing ${label}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
function currentForms() {
  return latest.sessions[0].forms;
}
function successfulUpdate(update: (data: typeof latest) => void) {
  vi.mocked(apiClient.request).mockImplementation(async () => {
    const next = clone(latest);
    update(next);
    latest = next;
    return { data: { success: true, data: next } };
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('rendered mobile QA form workflow', () => {
  it('renders one locked PP Sample form and requires an explicit QA decision', async () => {
    const data = detail([form('form-m', 'M')]);
    const selected = data.sessions[0].forms[0]!;
    selected.sampleQuantity = 5;
    selected.inspectedQuantity = 0;
    selected.acceptedQuantity = 0;
    selected.reworkQuantity = 0;
    data.sessions[0].processFlowPpSample = {
      executionId: 'execution-1',
      processFlowActivityId: 'activity-1',
      qualityFormVersionId: 'sample-v1',
      sampleQuantity: 5,
      decision: null,
    };
    successfulUpdate(() => {});
    await renderPage(data);
    expect(container.querySelector('[data-quality-execution-shell="true"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('PP Sample Checklist');
    expect(container.textContent).toContain('PP Sample form · Attempt 1 · DRAFT');
    const back = container.querySelector('a[aria-label="Back to Job Order JO-1"]');
    expect(back?.textContent).toContain('Job Order JO-1');
    expect(back?.getAttribute('href')).toBe('/job-orders/job-1');
    expect(
      container.querySelector('[data-quality-execution-header="true"]')?.textContent,
    ).not.toContain('JO-1');
    expect(container.textContent).not.toContain('← QA queue');
    expect(container.textContent).toContain('PP Sample Decision');
    expect(container.textContent).not.toContain('Size S');
    expect(container.querySelector('[aria-label="M accepted"]')).toBeNull();
    expect(container.querySelector('[aria-label="M rework"]')).toBeNull();
    expect(container.querySelector('[aria-label="M rejected"]')).toBeNull();
    expect(
      (container.querySelector('[aria-label="Sample quantity"]') as HTMLInputElement).disabled,
    ).toBe(true);
    const firstResponse = container.querySelector('[role="radiogroup"][aria-label$="response"]')!;
    expect(
      Array.from(firstResponse.querySelectorAll('input[type="radio"]')).map(
        (option) => (option as HTMLInputElement).value,
      ),
    ).toEqual(['YES', 'NO']);
    expect((firstResponse.querySelector('input[value="YES"]') as HTMLInputElement).checked).toBe(
      true,
    );
    await click('Save size form');
    const savedPayload = vi.mocked(apiClient.request).mock.calls[0]![0].data;
    expect(savedPayload).not.toHaveProperty('inspectedQuantity');
    expect(savedPayload).not.toHaveProperty('acceptedQuantity');
    expect(savedPayload).not.toHaveProperty('reworkQuantity');
    expect(savedPayload).not.toHaveProperty('permanentlyRejectedQuantity');
    vi.mocked(apiClient.request).mockClear();
    await click('Finalize size M');
    expect(container.textContent).toContain('Choose Pass or Fail');
    expect(vi.mocked(apiClient.request)).not.toHaveBeenCalled();
    await act(async () =>
      (
        container.querySelector('input[name="pp-decision"][type="radio"]') as HTMLInputElement
      ).click(),
    );
    await click('Finalize size M');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/session-1/forms/form-m/finalize',
        data: { expectedVersion: 1, ppSampleDecision: 'PASS' },
      }),
    );
  });

  it('navigates three rendered sizes without leaking their values', async () => {
    const data = detail();
    data.sessions[0].forms[0].sampleQuantity = 2;
    data.sessions[0].forms[0].acceptedQuantity = 7;
    data.sessions[0].forms[1].sampleQuantity = 5;
    data.sessions[0].forms[1].acceptedQuantity = 3;
    data.sessions[0].forms[2].sampleQuantity = 4;
    data.sessions[0].forms[2].checklist[0]!.remarks = 'L only';
    await renderPage(data);
    expect(container.textContent).toContain('Size S');
    expect(container.textContent).toContain('Size M');
    expect(container.textContent).toContain('Size L');
    expect(
      (container.querySelector('[aria-label="Sample quantity"]') as HTMLInputElement).value,
    ).toBe('2');
    await click('Size M');
    expect(
      (container.querySelector('[aria-label="Sample quantity"]') as HTMLInputElement).value,
    ).toBe('5');
    expect((container.querySelector('[aria-label="M accepted"]') as HTMLInputElement).value).toBe(
      '3',
    );
    expect(container.querySelector('[aria-label="S accepted"]') as HTMLInputElement).toBeNull();
    await click('Size L');
    expect(
      (container.querySelector('[aria-label="Sample quantity"]') as HTMLInputElement).value,
    ).toBe('4');
    expect(
      (
        container.querySelector(
          `[aria-label="${QA_CHECKLIST_ITEMS[0]!.label} remarks"]`,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('L only');
    await click('Size S');
    expect(
      (container.querySelector('[aria-label="Sample quantity"]') as HTMLInputElement).value,
    ).toBe('2');
    expect((container.querySelector('[aria-label="S accepted"]') as HTMLInputElement).value).toBe(
      '7',
    );
  });

  it('saves only selected M form with its ID and version while siblings stay unchanged', async () => {
    successfulUpdate((data) => {
      const m = data.sessions[0].forms[1]!;
      m.version = 5;
      m.acceptedQuantity = 6;
      m.inspectedQuantity = 7;
    });
    await renderPage();
    await click('Size M');
    await change('M accepted', '6');
    await click('Save size form');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/session-1/forms/form-m',
        method: 'put',
        data: expect.objectContaining({ expectedVersion: 4, acceptedQuantity: 6 }),
      }),
    );
    expect(JSON.stringify(vi.mocked(apiClient.request).mock.calls)).not.toContain('form-s');
    expect(JSON.stringify(vi.mocked(apiClient.request).mock.calls)).not.toContain('form-l');
    await act(async () => {});
    expect(currentForms()[1]!.version).toBe(5);
    expect(currentForms()[0]!.version).toBe(1);
    expect(currentForms()[2]!.version).toBe(1);
  });

  it('finalizes only selected M form and makes it read-only', async () => {
    successfulUpdate((data) => {
      data.sessions[0].forms[1]!.status = 'FINALIZED';
      data.sessions[0].forms[1]!.version = 5;
    });
    await renderPage();
    await click('Size M');
    await click('Finalize size M');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/session-1/forms/form-m/finalize',
        method: 'post',
        data: { expectedVersion: 4 },
      }),
    );
    await act(async () => {});
    expect(container.textContent).toContain('M · FINALIZED');
    expect(
      (container.querySelector('[aria-label="M accepted"]') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain('Save size form');
    expect(currentForms()[0]!.status).toBe('DRAFT');
    expect(currentForms()[2]!.status).toBe('DRAFT');
  });

  it.each([['ADMIN'], ['MERCHANDISER']])('allows %s to reopen only finalized M', async (role) => {
    const data = detail();
    data.sessions[0].forms[1]!.status = 'FINALIZED';
    successfulUpdate((next) => {
      next.sessions[0].forms[1]!.status = 'REOPENED';
      next.sessions[0].forms[1]!.version = 5;
    });
    vi.spyOn(window, 'prompt').mockReturnValue('Correction');
    await renderPage(data, [role]);
    await click('Size M');
    await click('Reopen size');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/session-1/forms/form-m/reopen',
        data: { expectedVersion: 4, reason: 'Correction' },
      }),
    );
    await act(async () => {});
    expect(
      (container.querySelector('[aria-label="M accepted"]') as HTMLInputElement).disabled,
    ).toBe(false);
    expect(currentForms()[0]!.status).toBe('DRAFT');
    expect(currentForms()[2]!.status).toBe('DRAFT');
  });

  it.each([['QA_USER'], ['FACTORY_USER']])('does not offer reopen to %s', async (role) => {
    const data = detail();
    data.sessions[0].forms[1]!.status = 'FINALIZED';
    await renderPage(data, [role]);
    await click('Size M');
    expect(container.textContent).not.toContain('Reopen size');
  });

  it('enforces evidence ownership in the rendered form and exempts rework-only finalization', async () => {
    const data = detail();
    const s = data.sessions[0].forms[0]!;
    s.acceptedQuantity = 3;
    s.permanentlyRejectedQuantity = 1;
    s.inspectedQuantity = 4;
    data.sessions[0].evidence.push({
      id: 'b-evidence',
      inspectionLineId: 'form-m',
      fileName: 'M.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1,
      createdAt: 'now',
    });
    await renderPage(data);
    await click('Finalize size S');
    expect(container.textContent).toContain('requires evidence for this size');
    expect(vi.mocked(apiClient.request)).not.toHaveBeenCalled();
    latest.sessions[0].evidence.push({
      id: 's-evidence',
      inspectionLineId: 'form-s',
      fileName: 'S.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1,
      createdAt: 'now',
    });
    vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true } });
    const upload = container.querySelector(
      '[aria-label="Upload evidence for size S"]',
    ) as HTMLInputElement;
    Object.defineProperty(upload, 'files', {
      value: [new File(['x'], 'S.jpg', { type: 'image/jpeg' })],
    });
    await act(async () => {
      upload.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith(
      '/qa/inspections/session-1/evidence',
      expect.any(FormData),
    );
    await renderPage(latest);
    expect(container.textContent).toContain('S.jpg');
    successfulUpdate(() => {});
    await click('Finalize size S');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/qa/inspections/session-1/forms/form-s/finalize' }),
    );
    const rework = detail();
    rework.sessions[0].forms[0]!.acceptedQuantity = 3;
    rework.sessions[0].forms[0]!.reworkQuantity = 1;
    rework.sessions[0].forms[0]!.inspectedQuantity = 4;
    successfulUpdate(() => {});
    await renderPage(rework);
    await click('Finalize size S');
    expect(container.textContent).not.toContain('requires evidence for this size');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalled();
  });

  it('blocks negative, fractional, and over-capacity quantities through rendered Save', async () => {
    await renderPage();
    await change('S accepted', '-1');
    await click('Save size form');
    expect(container.textContent).toContain('non-negative whole');
    expect(vi.mocked(apiClient.request)).not.toHaveBeenCalled();
    await change('S accepted', '1.5');
    await click('Save size form');
    expect(container.textContent).toContain('non-negative whole');
    expect(vi.mocked(apiClient.request)).not.toHaveBeenCalled();
    await change('S accepted', '11');
    await click('Save size form');
    expect(container.textContent).toContain('cannot exceed 10');
    expect(vi.mocked(apiClient.request)).not.toHaveBeenCalled();
  });

  it('maps structured validation errors to selected M and separately identifies Size L', async () => {
    await renderPage();
    await click('Size M');
    const issue = (formId: string, lineId: string, field: string, message: string) => ({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: {
              issues: [
                { qaSizeInspectionFormId: formId, jobOrderLineSizeId: lineId, field, message },
              ],
            },
          },
        },
      },
    });
    vi.mocked(apiClient.request).mockRejectedValueOnce(
      issue('form-m', 'line-form-m', 'quantities', 'M quantities invalid'),
    );
    await click('Save size form');
    await act(async () => {});
    expect(container.textContent).toContain('M quantities invalid');
    vi.mocked(apiClient.request).mockRejectedValueOnce(
      issue('form-l', 'line-form-l', 'quantities', 'L quantities invalid'),
    );
    await click('Save size form');
    await act(async () => {});
    expect(container.textContent).toContain('Size L — L quantities invalid');
  });

  it('shows stale Save reload without retrying and preserves sibling forms', async () => {
    await renderPage();
    await click('Size M');
    vi.mocked(apiClient.request).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: { code: 'STALE_VERSION', message: 'stale' } } },
    });
    await click('Save size form');
    await act(async () => {});
    expect(container.textContent).toContain('This size inspection changed');
    expect(container.textContent).toContain('Reload latest size inspection');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledTimes(1);
    latest.sessions[0].forms[1]!.version = 5;
    latest.sessions[0].forms[1]!.acceptedQuantity = 8;
    await click('Reload latest size inspection');
    await renderPage(latest);
    await click('Size M');
    expect((container.querySelector('[aria-label="M accepted"]') as HTMLInputElement).value).toBe(
      '8',
    );
    expect(currentForms()[0]!.version).toBe(1);
    expect(currentForms()[2]!.version).toBe(1);
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledTimes(1);
  });

  it('shows stale Finalize reload without automatically retrying the lifecycle mutation', async () => {
    await renderPage();
    await click('Size M');
    vi.mocked(apiClient.request).mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: { code: 'STALE_VERSION', message: 'stale' } } },
    });
    await click('Finalize size M');
    await act(async () => {});
    expect(container.textContent).toContain('Reload latest size inspection');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledTimes(1);
    latest.sessions[0].forms[1]!.version = 5;
    await click('Reload latest size inspection');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.textContent).toContain('M · DRAFT');
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledTimes(1);
  });

  it('renders cycle and size separated history without merging reinspection M', async () => {
    const data = detail();
    const cycleTwo = form('form-m-cycle-2', 'M', 2);
    cycleTwo.acceptedQuantity = 9;
    data.sessions.push({
      ...clone(data.sessions[0]),
      id: 'session-2',
      cycleNumber: 2,
      forms: [cycleTwo],
    });
    await renderPage(data);
    expect(container.textContent).toContain('Cycle 1');
    expect(container.textContent).toContain('Cycle 2 · Reinspection');
    expect(container.textContent).toContain('Size S · DRAFT');
    expect(container.textContent).toContain('Size L · DRAFT');
    expect(container.textContent).toContain('Size M · DRAFT · accepted 3');
    expect(container.textContent).toContain('Size M · DRAFT · accepted 9');
    expect(container.textContent).not.toContain('form-m-cycle-2');
  });

  it('uses the same semantic read-only checklist for finalized PP Sample cycles', async () => {
    const data = detail([form('form-m', 'M')]);
    const session = data.sessions[0]!;
    const finalized = session.forms[0]!;
    session.status = 'FINALIZED';
    finalized.status = 'FINALIZED';
    session.processFlowPpSample = {
      executionId: 'execution-1',
      processFlowActivityId: 'activity-1',
      qualityFormVersionId: 'sample-v1',
      sampleQuantity: 5,
      decision: 'PASS',
    };
    finalized.checklist = QA_CHECKLIST_ITEMS.map(({ code }) => ({
      itemCode: code,
      status: 'YES',
      remarks: 'Approved',
    }));

    await renderPage(data);

    expect(container.querySelectorAll('[data-quality-checklist-result="true"]')).toHaveLength(30);
    expect(container.querySelector('[role="radiogroup"][aria-label$="response"]')).toBeNull();
    expect(
      container.querySelector('[data-quality-checklist="true"] input[type="radio"]'),
    ).toBeNull();
    expect(container.textContent).toContain('\u2713Yes');
    expect(container.textContent).toContain('sample quantity 5 · decision PASS · FINALIZED');
  });
});
