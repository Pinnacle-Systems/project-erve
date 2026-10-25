/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityExecutionView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { QualityExecutionPage } from './QualityExecutionPage.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Radix Select (the new attempt/batch history selectors) calls
  // scrollIntoView on open, which jsdom does not implement.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
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
const view: QualityExecutionView = {
  id: 'e1',
  jobOrderId: 'j1',
  jobOrderNumber: 'JO-2026-000001',
  primaryStyle: { consistent: true, style: { id: 'style-1', styleNumber: 'STY-0001', styleName: 'Basic Tee', primaryImage: null } },
  processFlowActivityId: 'a1',
  activityName: 'Final Inspection',
  qualityForm: {
    id: 'f1',
    code: 'FINAL',
    name: 'Final Inspection Report',
    versionId: 'v1',
    versionNumber: 1,
  },
  attemptNumber: 1,
  batchNumber: 2,
  inspectedQuantity: 25,
  ppSample: null,
  productionContext: null,
  coverage: {
    preparedQuantityAuthoritative: true,
    preparedQuantity: 60,
    inspectedQuantity: 20,
    remainingQuantity: 40,
    complete: false,
    reconciliationConflict: false,
    state: 'IN_PROGRESS',
    passedBatches: 1,
    failedBatches: 0,
    hasFailedBatches: false,
    batches: [
      {
        id: 'batch-1',
        batchNumber: 1,
        inspectedQuantity: 20,
        status: 'FINALIZED',
        outcome: 'PASS',
        finalizedAt: '2026-08-20T10:00:00.000Z',
      },
      {
        id: 'e1',
        batchNumber: 2,
        inspectedQuantity: 25,
        status: 'DRAFT',
        outcome: null,
        finalizedAt: null,
      },
    ],
  },
  status: 'DRAFT',
  version: 3,
  startedAt: '',
  finalizedAt: null,
  sections: [
    {
      id: 's1',
      sequence: 1,
      title: 'Evidence',
      components: [
        {
          id: 'files',
          sequence: 1,
          type: 'ATTACHMENTS',
          title: 'Attachments',
          config: { requirements: [{ key: 'photo', label: 'Inspection photo' }] },
        },
        {
          id: 'quantities',
          sequence: 2,
          type: 'QUANTITY_RECONCILIATION',
          title: 'Inspection and shipment sampling',
          config: {
            fields: [
              {
                key: 'quantityInspected',
                label: 'Quantity Inspected',
                dataType: 'NUMBER',
                source: 'SYSTEM',
              },
              { key: 'openCartons', label: 'Open Cartons', dataType: 'NUMBER' },
            ],
          },
          systemValue: [{ key: 'quantityInspected', value: 25, available: true }],
        },
      ],
    },
  ],
  responses: {
    expectedVersion: 3,
    checklistResponses: [],
    aqlResults: [],
    defects: [],
    correctiveActions: [],
    testResults: [],
    quantities: [],
    comments: [],
    fieldResponses: [],
    attendees: [],
    actions: [],
    signoffs: [],
    outcome: null,
  },
  attachments: [
    {
      id: 'attachment-1',
      componentId: 'files',
      requirementKey: 'photo',
      fileName: 'final-evidence.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      createdAt: '2026-08-20T10:00:00.000Z',
    },
  ],
};

describe('mobile Quality execution workflow', () => {
  it('renders the draft and uploads execution-scoped evidence', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: view } });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: {} } });
    await act(async () => {
      root.render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/quality-executions/e1']}>
            <Routes>
              <Route path="/quality-executions/:executionId" element={<QualityExecutionPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const back = container.querySelector('a[aria-label="Back to Job Order JO-2026-000001"]');
    expect(back?.textContent).toContain('Job Order JO-2026-000001');
    expect(back?.getAttribute('href')).toBe('/job-orders/j1');
    expect(container.textContent).toContain(
      'Prepared 60 · Previously inspected 20 · This inspection 25 · Remaining after this batch 15',
    );
    expect(container.textContent).toContain('final-evidence.jpg');
    expect(container.textContent).toContain('15 units remain after this batch.');
    expect(container.querySelector('[data-quality-field-grid="true"]')?.className).toContain(
      'grid-cols-1',
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['image'], 'inspection.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(post).toHaveBeenCalledWith('/quality-executions/e1/attachments', expect.any(FormData));
  });
});

// ISS-050/048: mobile shares the exact QualityExecutionForm component with
// web, so the attempt/batch selectors render identically — this covers only
// this page's own data-fetching/navigation wiring (attemptHistory lookup and
// the batch-switch GET+navigate), not the selector UI itself.
describe('mobile Quality execution history navigation (ISS-050/048)', () => {
  it("navigates to an earlier Inline QA attempt's own execution id, resolved from the Job Order detail response", async () => {
    const latest: QualityExecutionView = {
      ...view,
      activityName: 'Inline Inspection',
      qualityForm: { ...view.qualityForm, code: 'INLINE', name: 'Inline Inspection Report' },
      attemptNumber: 2,
      batchNumber: 1,
      coverage: null,
    };
    const earlier: QualityExecutionView = { ...latest, id: 'exec-1', attemptNumber: 1 };
    vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/job-orders/j1')
        return {
          data: {
            data: {
              id: 'j1',
              qualityActivities: [
                {
                  processFlowVersionStageId: 'a1',
                  executionHistory: [
                    { id: 'exec-1', attemptNumber: 1, status: 'FINALIZED', outcome: 'FAIL', startedAt: '', finalizedAt: '' },
                    { id: 'e1', attemptNumber: 2, status: 'FINALIZED', outcome: 'PASS', startedAt: '', finalizedAt: '' },
                  ],
                },
              ],
            },
          },
        };
      if (path === '/quality-executions/exec-1') return { data: { data: earlier } };
      return { data: { data: latest } };
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/quality-executions/e1']}>
            <Routes>
              <Route path="/quality-executions/:executionId" element={<QualityExecutionPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const trigger = await vi.waitFor(() => {
      const node = container.querySelector<HTMLButtonElement>('#quality-history-attempt-select');
      expect(node).not.toBeNull();
      return node!;
    });
    await act(async () => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const option = await vi.waitFor(() => {
      const node = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((item) =>
        item.textContent?.includes('Attempt 1'),
      );
      expect(node).not.toBeUndefined();
      return node!;
    });
    await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await vi.waitFor(() => expect(container.textContent).toContain('Viewing a historical, read-only attempt'));
  });

  // Correction 3 (post-review): a failed batch lookup must show a visible,
  // actionable error, never navigate, and reliably clear the loading state.
  it('shows an accessible error and stays on the current execution when the selected batch fails to load', async () => {
    const current: QualityExecutionView = {
      ...view,
      id: 'e1',
      attemptNumber: 1,
      batchNumber: 2,
      status: 'FINALIZED',
      coverage: {
        preparedQuantityAuthoritative: true,
        preparedQuantity: 72,
        inspectedQuantity: 60,
        remainingQuantity: 12,
        complete: false,
        reconciliationConflict: false,
        state: 'IN_PROGRESS',
        passedBatches: 1,
        failedBatches: 0,
        hasFailedBatches: false,
        batches: [
          { id: 'batch-1', batchNumber: 1, inspectedQuantity: 60, status: 'FINALIZED', outcome: 'PASS', finalizedAt: '2026-01-01T00:00:00Z' },
          { id: 'batch-2', batchNumber: 2, inspectedQuantity: 12, status: 'FINALIZED', outcome: 'PASS', finalizedAt: '2026-02-01T00:00:00Z' },
        ],
      },
      finalBatch: {
        id: 'batch-2',
        batchNumber: 2,
        physicalQuantity: 12,
        disposition: 'RELEASED',
        allocations: [],
        attempts: [{ id: 'e1', attemptNumber: 1, status: 'FINALIZED', outcome: 'PASS', rejectionReason: null, startedAt: '', finalizedAt: '2026-02-01T00:00:00Z' }],
        release: { id: 'release-2', releasedAt: '2026-02-01T00:00:00Z', quantity: 12 },
      },
    };
    vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
      const path = String(url);
      if (path === '/job-orders/j1') return { data: { data: { id: 'j1' } } };
      if (path === '/quality-executions/final-batches/batch-1') {
        const error = new Error('Request failed with status code 500') as Error & {
          isAxiosError?: boolean;
          response?: unknown;
        };
        error.isAxiosError = true;
        error.response = { data: { error: { message: 'Final Quality batch not found' } } };
        throw error;
      }
      return { data: { data: current } };
    });
    const post = vi.spyOn(apiClient, 'post');
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/quality-executions/e1']}>
            <Routes>
              <Route path="/quality-executions/:executionId" element={<QualityExecutionPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    const trigger = await vi.waitFor(() => {
      const node = container.querySelector<HTMLButtonElement>('#quality-history-batch-select');
      expect(node).not.toBeNull();
      return node!;
    });
    await act(async () => trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const option = await vi.waitFor(() => {
      const node = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((item) =>
        item.textContent?.includes('Batch 1'),
      );
      expect(node).not.toBeUndefined();
      return node!;
    });
    await act(async () => option.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
        'Final Quality batch not found',
      ),
    );
    // Stays on the previously displayed batch (2) — no navigation. Mobile's
    // non-compact header doesn't render a batch-number suffix at all (a
    // pre-existing asymmetry with web, unrelated to this fix), so this
    // checks the batch selector's own current value instead.
    expect(container.querySelector('#quality-history-batch-select')?.textContent).toContain(
      'Batch 2',
    );
    expect(container.textContent).not.toContain('Loading selected batch');
    expect(post).not.toHaveBeenCalled();
  });
});
