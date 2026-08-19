/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QA_CHECKLIST_ITEMS, type QaInspectionDetail } from '@erve/types';
import { QaInspectionForm } from './QaInspectionForm.js';
import { canReopenQaForm } from './QaDetailPage.js';
import { apiClient } from '../../lib/api-client.js';

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
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function detail(): QaInspectionDetail {
  return {
    id: 'jo-1',
    jobOrderNumber: 'JO-001',
    purchaseOrderNumber: 'PO-001',
    factory: { id: 'factory-1', code: 'F1', name: 'Factory' },
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor' },
    seasons: [{ code: 'SUMMER', displayName: 'Summer 26' }],
    status: 'QA_IN_PROGRESS',
    version: 2,
    updatedAt: '2026-08-06T10:00:00Z',
    totals: {
      prepared: 10,
      availableToInspect: 10,
      accepted: 0,
      rework: 0,
      awaitingReinspection: 0,
      permanentlyRejected: 0,
      finalApproved: 0,
    },
    lines: [
      {
        jobOrderLineSizeId: 'allocation-1',
        styleNumber: 'STYLE-1',
        styleName: 'Style',
        colour: 'Navy',
        sizeCode: 'M',
        sizeLabel: 'M',
        orderedQuantity: 10,
        preparedQuantity: 10,
        availableToInspect: 10,
        acceptedQuantity: 0,
        reworkQuantity: 0,
        awaitingReinspectionQuantity: 0,
        permanentlyRejectedQuantity: 0,
      },
      {
        jobOrderLineSizeId: 'allocation-2',
        styleNumber: 'STYLE-1',
        styleName: 'Style',
        colour: 'Navy',
        sizeCode: 'L',
        sizeLabel: 'L',
        orderedQuantity: 8,
        preparedQuantity: 8,
        availableToInspect: 8,
        acceptedQuantity: 0,
        reworkQuantity: 0,
        awaitingReinspectionQuantity: 0,
        permanentlyRejectedQuantity: 0,
      },
      {
        jobOrderLineSizeId: 'allocation-3',
        styleNumber: 'STYLE-1',
        styleName: 'Style',
        colour: 'Navy',
        sizeCode: 'XL',
        sizeLabel: 'XL',
        orderedQuantity: 6,
        preparedQuantity: 6,
        availableToInspect: 6,
        acceptedQuantity: 0,
        reworkQuantity: 0,
        awaitingReinspectionQuantity: 0,
        permanentlyRejectedQuantity: 0,
      },
    ],
    reworkTasks: [],
    sessions: [
      {
        id: 'inspection-1',
        cycleNumber: 1,
        status: 'DRAFT',
        inspector: { id: 'qa-1', name: 'QA User', email: 'qa@example.test' },
        finalizedAt: null,
        reopenedAt: null,
        reopenReason: null,
        forms: [
          {
            id: 'form-1',
            status: 'DRAFT',
            version: 1,
            finalizedAt: null,
            reopenedAt: null,
            reopenReason: null,
            jobOrderLineSizeId: 'allocation-1',
            sourceReworkTaskId: null,
            styleNumber: 'STYLE-1',
            styleName: 'Style',
            colour: 'Navy',
            sizeCode: 'M',
            sizeLabel: 'M',
            preparedQuantity: 10,
            sampleQuantity: 2,
            checklist: QA_CHECKLIST_ITEMS.map(({ code }, index) => ({
              itemCode: code,
              status: index === 0 ? 'YES' : null,
              remarks: index === 0 ? 'Checked' : null,
            })),
            inspectionRemarks: null,
            inspectedQuantity: 10,
            acceptedQuantity: 10,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
            defectCategory: null,
            otherDefectDetails: null,
            defectNotes: null,
          },
          {
            id: 'form-2',
            status: 'FINALIZED',
            version: 4,
            finalizedAt: '2026-08-06T12:00:00Z',
            reopenedAt: null,
            reopenReason: null,
            jobOrderLineSizeId: 'allocation-2',
            sourceReworkTaskId: null,
            styleNumber: 'STYLE-1',
            styleName: 'Style',
            colour: 'Navy',
            sizeCode: 'L',
            sizeLabel: 'L',
            preparedQuantity: 8,
            sampleQuantity: 3,
            checklist: QA_CHECKLIST_ITEMS.map(({ code }) => ({
              itemCode: code,
              status: 'NO',
              remarks: 'L only',
            })),
            inspectionRemarks: 'L form',
            inspectedQuantity: 8,
            acceptedQuantity: 8,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
            defectCategory: null,
            otherDefectDetails: null,
            defectNotes: null,
          },
          {
            id: 'form-3',
            status: 'DRAFT',
            version: 2,
            finalizedAt: null,
            reopenedAt: null,
            reopenReason: null,
            jobOrderLineSizeId: 'allocation-3',
            sourceReworkTaskId: null,
            styleNumber: 'STYLE-1',
            styleName: 'Style',
            colour: 'Navy',
            sizeCode: 'XL',
            sizeLabel: 'XL',
            preparedQuantity: 6,
            sampleQuantity: 4,
            checklist: QA_CHECKLIST_ITEMS.map(({ code }) => ({
              itemCode: code,
              status: 'AVAILABLE',
              remarks: 'XL only',
            })),
            inspectionRemarks: 'XL form',
            inspectedQuantity: 6,
            acceptedQuantity: 6,
            reworkQuantity: 0,
            permanentlyRejectedQuantity: 0,
            defectCategory: null,
            otherDefectDetails: null,
            defectNotes: null,
          },
        ],
        evidence: [],
        createdAt: '2026-08-06T10:00:00Z',
        updatedAt: '2026-08-06T10:00:00Z',
        version: 1,
      },
    ],
  };
}
async function renderForm() {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <QaInspectionForm detail={detail()} canMutate onUpdated={() => undefined} />
      </QueryClientProvider>,
    ),
  );
}

function editableRejectedM(source = detail()) {
  const form = source.sessions[0]!.forms[0]!;
  form.acceptedQuantity = 8;
  form.permanentlyRejectedQuantity = 2;
  form.defectCategory = 'FABRIC';
  form.checklist = QA_CHECKLIST_ITEMS.map(({ code }) => ({
    itemCode: code,
    status: 'YES',
    remarks: 'Checked',
  }));
  return source;
}

function FormHarness({
  initial,
  canMutate = true,
  canReopen = false,
}: {
  initial: QaInspectionDetail;
  canMutate?: boolean;
  canReopen?: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  return (
    <QaInspectionForm
      detail={current}
      canMutate={canMutate}
      canReopen={canReopen}
      onUpdated={setCurrent}
    />
  );
}

async function renderHarness(initial: QaInspectionDetail, canMutate = true, canReopen = false) {
  await act(async () =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FormHarness initial={initial} canMutate={canMutate} canReopen={canReopen} />
      </QueryClientProvider>,
    ),
  );
}

function button(label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  ) as HTMLButtonElement;
}

function responseControl(label: string) {
  return container.querySelector(`[aria-label="${label} response"]`) as HTMLButtonElement;
}

describe('QaInspectionForm', () => {
  it.each([
    ['ADMIN', true],
    ['MERCHANDISER', true],
    ['QA_USER', false],
    ['FACTORY_USER', false],
    ['DISTRIBUTOR', false],
    ['ACCOUNTANT', false],
    ['SENIOR_MANAGEMENT', false],
  ])('derives %s reopen access as %s', (role, expected) => {
    expect(canReopenQaForm([role])).toBe(expected);
  });

  it('does not grant reopen access without an authenticated role', () => {
    expect(canReopenQaForm(undefined)).toBe(false);
  });

  it('renders one locked PP Sample context and sends the explicit QA decision', async () => {
    const source = detail();
    const form = source.sessions[0]!.forms[0]!;
    source.sessions[0]!.forms = [form];
    source.sessions[0]!.processFlowPpSample = {
      executionId: 'execution-1',
      processFlowActivityId: 'activity-1',
      qualityFormVersionId: 'sample-v1',
      sampleQuantity: 5,
      decision: null,
    };
    form.sampleQuantity = 5;
    form.inspectedQuantity = 5;
    form.acceptedQuantity = 5;
    form.checklist = QA_CHECKLIST_ITEMS.map(({ code }) => ({
      itemCode: code,
      status: 'YES',
      remarks: null,
    }));
    const requestCall = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: source } } as never);
    await renderHarness(source);

    expect(container.textContent).toContain('Selected sizeM');
    expect(container.textContent).not.toContain('Size L');
    expect((container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).disabled).toBe(true);
    await act(async () => button('Finalize size M').click());
    expect(container.textContent).toContain('Choose Pass or Fail before finalizing PP Sample.');
    expect(requestCall).not.toHaveBeenCalled();

    await act(async () => (container.querySelector('input[value="FAIL"]') as HTMLInputElement).click());
    await act(async () => button('Finalize size M').click());
    expect(requestCall).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/inspection-1/forms/form-1/finalize',
        data: { expectedVersion: 1, ppSampleDecision: 'FAIL' },
      }),
    );
  }, 15_000);

  it('renders every paper-form checkpoint once in documented order and restores saved values', async () => {
    await renderForm();
    const labels = QA_CHECKLIST_ITEMS.map(({ label }) => label);
    expect(container.textContent).toContain('QA Inspection Form');
    expect(container.querySelectorAll('button[aria-label$="response"]')).toHaveLength(15);
    expect(labels.every((label) => container.textContent?.includes(label))).toBe(true);
    expect(container.textContent!.indexOf(labels[0]!)).toBeLessThan(
      container.textContent!.indexOf(labels[14]!),
    );
    expect(container.textContent!.indexOf(labels[14]!)).toBeLessThan(
      container.textContent!.indexOf('Inspection remarks'),
    );
    expect(container.textContent!.indexOf('Inspection remarks')).toBeLessThan(
      container.textContent!.indexOf('Inspection outcome'),
    );
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).value,
    ).toBe('2');
    expect(responseControl(labels[0]!).textContent).toContain('Yes');
  });

  it('saves sample quantity, checklist values, remarks, and canonical size-allocation IDs', async () => {
    const post = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: detail() } } as never);
    await renderForm();
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Save size form',
        ) as HTMLButtonElement
      ).click(),
    );
    const call = post.mock.calls[0]![0] as {
      url: string;
      data: {
        sampleQuantity: number;
        checklist: Array<{ itemCode: string; status: string | null; remarks: string | null }>;
        acceptedQuantity: number;
      };
    };
    expect(call.data.sampleQuantity).toBe(2);
    expect(call.data.checklist[0]).toMatchObject({
      itemCode: 'FABRIC_COLOUR_QUALITY',
      status: 'YES',
      remarks: 'Checked',
    });
    expect(call.url).toBe('/qa/inspections/inspection-1/forms/form-1');
  });

  it('clearly reports when client validation prevents finalization and clears stale success feedback', async () => {
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: detail() } } as never);
    await renderForm();

    await act(async () => button('Save size form').click());
    expect(container.textContent).toContain('Size form updated.');
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => button('Finalize size M').click());
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Size form updated.');
    expect(container.textContent).toContain('Size M was not finalized. Review the highlighted fields.');
    expect(container.textContent).toContain('A response is required to finalize.');
  });

  it('shows the first blocking reason beside the actions when rework has no defect category', async () => {
    const source = editableRejectedM();
    const form = source.sessions[0]!.forms[0]!;
    form.permanentlyRejectedQuantity = 0;
    form.reworkQuantity = 2;
    form.defectCategory = null;
    const request = vi.spyOn(apiClient, 'request');
    await renderHarness(source);

    await act(async () => button('Finalize size M').click());

    expect(request).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Size M was not finalized. Review the highlighted field.');
    expect(container.textContent).toContain('Choose a defect category.');
    expect(container.querySelector('#select-defect-category')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(container.textContent?.match(/Choose a defect category\./g)).toHaveLength(1);

    await act(async () =>
      (container.querySelector('#select-defect-category') as HTMLButtonElement).click(),
    );
    const stitching = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.trim() === 'STITCHING',
    ) as HTMLElement;
    await act(async () => stitching.click());
    expect(container.querySelector('#select-defect-category')?.getAttribute('aria-invalid')).toBe(
      null,
    );
    expect(container.textContent).not.toContain('Choose a defect category.');
    expect(container.textContent).not.toContain('Size M was not finalized.');
  });

  it('saves an incomplete defect draft while reserving defect completeness for finalization', async () => {
    const source = editableRejectedM();
    const form = source.sessions[0]!.forms[0]!;
    form.permanentlyRejectedQuantity = 0;
    form.reworkQuantity = 2;
    form.defectCategory = null;
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: source } } as never);
    await renderHarness(source);

    await act(async () => button('Save size form').click());

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'put',
        data: expect.objectContaining({ reworkQuantity: 2, defectCategory: null }),
      }),
    );
    expect(container.textContent).toContain('Size form updated.');
    expect(container.textContent).not.toContain('Choose a defect category.');
  });

  it('clears selected-size feedback when navigating to another size', async () => {
    vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: detail() } } as never);
    await renderForm();

    await act(async () => button('Save size form').click());
    expect(container.textContent).toContain('Size form updated.');

    const sizeL = Array.from(container.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('Size L'),
    ) as HTMLButtonElement;
    await act(async () => sizeL.click());
    expect(container.textContent).not.toContain('Size form updated.');
  });

  it('automatically clears success feedback when staying on the same size', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: detail() } } as never);
      await renderForm();

      await act(async () => button('Save size form').click());
      expect(container.textContent).toContain('Size form updated.');

      await act(async () => vi.advanceTimersByTime(5000));
      expect(container.textContent).not.toContain('Size form updated.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows a saved draft to be edited when its own reservation leaves zero unreserved quantity', async () => {
    const source = detail();
    source.lines[0]!.availableToInspect = 0;
    source.sessions[0]!.forms[0]!.inspectedQuantity = 10;
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: source } } as never);
    await renderHarness(source);
    await act(async () => button('Save size form').click());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/qa/inspections/inspection-1/forms/form-1',
        data: expect.objectContaining({ acceptedQuantity: 10 }),
      }),
    );
    expect(container.textContent).not.toContain('Quantities cannot exceed 0');
  });

  it('retains a reserved draft size row and exposes the exact response choices without defaults', async () => {
    await renderForm();
    const response = responseControl(QA_CHECKLIST_ITEMS[1]!.label);
    expect(response.textContent).toContain('Unanswered');
    await act(async () => response.click());
    expect(
      Array.from(document.body.querySelectorAll('[role="option"]')).map((option) =>
        option.textContent?.trim(),
      ),
    ).toEqual(['Unanswered', 'Yes', 'No', 'Available']);
    expect((container.querySelector('[aria-label="M accepted"]') as HTMLInputElement).value).toBe(
      '10',
    );
  });

  it('does not expose mutation controls to a view-only role', async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <QaInspectionForm detail={detail()} canMutate={false} onUpdated={() => undefined} />
        </QueryClientProvider>,
      ),
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });

  it('navigates three isolated size forms without showing internal identifiers', async () => {
    await renderForm();
    expect(container.textContent).toContain('Size M');
    expect(container.textContent).toContain('Size L');
    expect(container.textContent).toContain('Size XL');
    expect(container.textContent).not.toContain('form-2');
    const l = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Size L'),
    )!;
    await act(async () => l.click());
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).value,
    ).toBe('3');
    expect(responseControl(QA_CHECKLIST_ITEMS[0]!.label).textContent).toContain('No');
    const xl = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Size XL'),
    )!;
    await act(async () => xl.click());
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).value,
    ).toBe('4');
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Size M'),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).value,
    ).toBe('2');
  });

  it('keeps finalized forms read-only while allowing authorized reopen control', async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <QaInspectionForm detail={detail()} canMutate canReopen onUpdated={() => undefined} />
        </QueryClientProvider>,
      ),
    );
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('Size L'),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(container.textContent).toContain('Reopen size L');
    expect(container.textContent).not.toContain('Save size form');
  });

  it('offers Reload latest after a stale save and does not retry the mutation', async () => {
    const request = vi.spyOn(apiClient, 'request').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'STALE_VERSION', message: 'stale' } } },
    });
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: detail() } } as never);
    await renderForm();
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Save size form',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(container.textContent).toContain(
      'This size inspection has changed since you opened it.',
    );
    expect(container.textContent).toContain('Reload latest');
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Reload latest',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(get).toHaveBeenCalledWith('/qa/job-orders/jo-1');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('identifies the human-readable size for a structured error on another form', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid',
            details: {
              issues: [
                {
                  path: ['forms', 'form-2', 'acceptedQuantity'],
                  message: 'Quantity exceeds capacity',
                },
              ],
            },
          },
        },
      },
    });
    await renderForm();
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find(
          (button) => button.textContent === 'Save size form',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(container.textContent).toContain('Size L: Quantity exceeds capacity');
  });

  it('shows only OTHER details for OTHER and uses defect notes for controlled categories', async () => {
    const other = detail();
    other.sessions[0]!.forms[0]!.defectCategory = 'OTHER';
    other.sessions[0]!.forms[0]!.otherDefectDetails = 'Loose stitches';
    other.sessions[0]!.forms[0]!.defectNotes = 'Legacy duplicate note';
    await renderHarness(other);
    expect(container.querySelector('[aria-label="Other defect details"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Defect notes"]')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    const controlled = detail();
    controlled.sessions[0]!.forms[0]!.defectCategory = 'FABRIC';
    controlled.sessions[0]!.forms[0]!.defectNotes = 'Fabric flaw';
    await renderHarness(controlled);
    expect(container.querySelector('[aria-label="Other defect details"]')).toBeNull();
    expect(container.querySelector('[aria-label="Defect notes"]')).not.toBeNull();
  });

  it('uploads evidence for the selected size, refreshes it, and unblocks that size finalization', async () => {
    const initial = editableRejectedM();
    const refreshed = editableRejectedM();
    initial.sessions[0]!.evidence = [
      {
        id: 'evidence-l',
        inspectionLineId: 'form-2',
        fileName: 'l-only.png',
        contentType: 'image/png',
        sizeBytes: 1,
        createdAt: '2026-08-06T11:00:00Z',
      },
    ];
    refreshed.sessions[0]!.evidence = [
      {
        id: 'evidence-m',
        inspectionLineId: 'form-1',
        fileName: 'proof.png',
        contentType: 'image/png',
        sizeBytes: 1,
        createdAt: '2026-08-06T11:00:00Z',
      },
    ];
    const saved = structuredClone(refreshed);
    saved.sessions[0]!.forms[0]!.version = 2;
    const finalized = structuredClone(saved);
    finalized.sessions[0]!.forms[0]!.version = 3;
    finalized.sessions[0]!.forms[0]!.status = 'FINALIZED';
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: {} } } as never);
    const request = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValueOnce({ data: { data: saved } } as never)
      .mockResolvedValueOnce({ data: { data: finalized } } as never);
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: refreshed } } as never);
    await renderHarness(initial);
    await act(async () => button('Finalize size M').click());
    expect(container.textContent).toContain(
      'Evidence for this size is required before permanent rejection can be finalized.',
    );
    expect(container.textContent).not.toContain(
      'Permanent rejection requires evidence attached to this exact size.',
    );
    expect(container.textContent).toContain(
      'Size M was not finalized. Review the highlighted field.',
    );
    expect(
      container.textContent?.match(
        /Evidence for this size is required before permanent rejection can be finalized\./g,
      ),
    ).toHaveLength(1);
    expect(request).not.toHaveBeenCalled();
    const input = container.querySelector(
      '[aria-label="Upload evidence for size M"]',
    ) as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'proof.png', { type: 'image/png' })],
    });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    const body = post.mock.calls[0]![1] as FormData;
    expect(body.get('inspectionLineId')).toBe('form-1');
    expect(body.get('image')).toBeInstanceOf(File);
    expect(container.textContent).toContain('proof.png');
    await act(async () => button('Finalize size M').click());
    expect(container.textContent).not.toContain(
      'Evidence for this size is required before permanent rejection can be finalized.',
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toMatchObject({
      url: '/qa/inspections/inspection-1/forms/form-1',
      method: 'put',
      data: expect.objectContaining({
        expectedVersion: 1,
        sampleQuantity: 2,
        inspectedQuantity: 10,
        acceptedQuantity: 8,
        permanentlyRejectedQuantity: 2,
      }),
    });
    expect(request.mock.calls[1]![0]).toMatchObject({
        url: '/qa/inspections/inspection-1/forms/form-1/finalize',
        method: 'post',
        data: { expectedVersion: 2 },
    });
    expect(container.textContent).toContain('Size M finalized.');
  });

  it('removes selected-size evidence using the compact delete action', async () => {
    const source = editableRejectedM();
    source.sessions[0]!.evidence = [
      {
        id: 'evidence-m',
        inspectionLineId: 'form-1',
        fileName: 'proof.png',
        contentType: 'image/png',
        sizeBytes: 1,
        createdAt: '2026-08-06T11:00:00Z',
      },
    ];
    const refreshed = editableRejectedM();
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({} as never);
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: refreshed } } as never);
    await renderHarness(source);
    const control = container.querySelector('[aria-label="Remove proof.png"]') as HTMLButtonElement;
    expect(control).not.toBeNull();
    await act(async () => control.click());
    expect(remove).toHaveBeenCalledWith('/qa/evidence/evidence-m');
    expect(container.textContent).toContain('Evidence removed from size M.');
  });

  it('keeps evidence isolated by size and does not require it for rework-only finalization', async () => {
    const source = editableRejectedM();
    source.sessions[0]!.evidence = [
      {
        id: 'evidence-l',
        inspectionLineId: 'form-2',
        fileName: 'l-only.png',
        contentType: 'image/png',
        sizeBytes: 1,
        createdAt: '2026-08-06T11:00:00Z',
      },
    ];
    const m = source.sessions[0]!.forms[0]!;
    m.permanentlyRejectedQuantity = 0;
    m.acceptedQuantity = 8;
    m.reworkQuantity = 2;
    vi.spyOn(apiClient, 'request').mockResolvedValue({ data: { data: source } } as never);
    await renderHarness(source);
    expect(container.textContent).toContain('No evidence attached to this size.');
    expect(container.textContent).not.toContain(
      'Permanent rejection requires evidence attached to this exact size.',
    );
    await act(async () => button('Finalize size M').click());
    expect(container.textContent).not.toContain(
      'Evidence for this size is required before permanent rejection can be finalized.',
    );
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((item) =>
          item.textContent?.includes('Size L'),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(container.textContent).toContain('l-only.png');
    expect(container.textContent).not.toContain('View proof.png');
  });

  it('offers Reload latest after a stale finalization without retrying and preserves sibling forms', async () => {
    const initial = editableRejectedM();
    const latest = editableRejectedM();
    const evidence = {
      id: 'evidence-m',
      inspectionLineId: 'form-1',
      fileName: 'proof.png',
      contentType: 'image/png',
      sizeBytes: 1,
      createdAt: '2026-08-06T11:00:00Z',
    };
    initial.sessions[0]!.evidence = [evidence];
    latest.sessions[0]!.evidence = [evidence];
    latest.sessions[0]!.forms[0]!.version = 2;
    latest.sessions[0]!.forms[1]!.sampleQuantity = 3;
    const request = vi.spyOn(apiClient, 'request').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'STALE_VERSION', message: 'stale' } } },
    });
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: latest } } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await renderHarness(initial);
    await act(async () => button('Finalize size M').click());
    expect(container.textContent).toContain(
      'This size inspection has changed since you opened it.',
    );
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => button('Reload latest').click());
    expect(get).toHaveBeenCalledWith('/qa/job-orders/jo-1');
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => button('Finalize size M').click());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0]).toMatchObject({ data: { expectedVersion: 2 } });
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((item) =>
          item.textContent?.includes('Size L'),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(
      (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement).value,
    ).toBe('3');
  });

  it.each(['ADMIN', 'MERCHANDISER'])(
    '%s can reopen finalized size B with its current form version',
    async () => {
      const initial = detail();
      initial.sessions[0]!.forms[0]!.status = 'FINALIZED';
      initial.sessions[0]!.forms[2]!.status = 'FINALIZED';
      const reopened = detail();
      reopened.sessions[0]!.forms[0]!.status = 'FINALIZED';
      reopened.sessions[0]!.forms[1]!.status = 'REOPENED';
      reopened.sessions[0]!.forms[1]!.version = 5;
      reopened.sessions[0]!.forms[2]!.status = 'FINALIZED';
      const request = vi
        .spyOn(apiClient, 'request')
        .mockResolvedValue({ data: { data: reopened } } as never);
      await renderHarness(initial, true, true);
      await act(async () =>
        (
          Array.from(container.querySelectorAll('button')).find((item) =>
            item.textContent?.includes('Size L'),
          ) as HTMLButtonElement
        ).click(),
      );
      await act(async () => button('Reopen size L').click());
      const reason = document.querySelector('#field-reason') as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          reason,
          'Correction required',
        );
        reason.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () =>
        (
          Array.from(document.querySelectorAll('button')).find(
            (item) => item.textContent === 'Reopen',
          ) as HTMLButtonElement
        ).click(),
      );
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/qa/inspections/inspection-1/forms/form-2/reopen',
          method: 'post',
          data: { expectedVersion: 4, reason: 'Correction required' },
        }),
      );
      expect(container.textContent).toContain('REOPENED');
      expect(
        (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement)
          .disabled,
      ).toBe(false);
      await act(async () =>
        (
          Array.from(container.querySelectorAll('button')).find((item) =>
            item.textContent?.includes('Size M'),
          ) as HTMLButtonElement
        ).click(),
      );
      expect(
        (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement)
          .disabled,
      ).toBe(true);
      await act(async () =>
        (
          Array.from(container.querySelectorAll('button')).find((item) =>
            item.textContent?.includes('Size XL'),
          ) as HTMLButtonElement
        ).click(),
      );
      expect(
        (container.querySelector('[aria-label="Quantity of samples"]') as HTMLInputElement)
          .disabled,
      ).toBe(true);
    },
  );

  it.each(['QA_USER', 'FACTORY_USER'])('%s cannot reopen a finalized size form', async () => {
    await renderHarness(detail(), true, false);
    await act(async () =>
      (
        Array.from(container.querySelectorAll('button')).find((item) =>
          item.textContent?.includes('Size L'),
        ) as HTMLButtonElement
      ).click(),
    );
    expect(button('Reopen size L')).toBeUndefined();
  });
});
