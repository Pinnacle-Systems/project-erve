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
  processFlowActivityId: 'a1',
  activityName: 'Inline Inspection',
  qualityForm: {
    id: 'f1',
    code: 'INLINE',
    name: 'Inline Inspection Report',
    versionId: 'v1',
    versionNumber: 1,
  },
  attemptNumber: 1,
  batchNumber: 1,
  inspectedQuantity: null,
  ppSample: null,
  productionContext: null,
  coverage: null,
  status: 'DRAFT',
  version: 1,
  startedAt: '',
  finalizedAt: null,
  sections: [
    {
      id: 's1',
      sequence: 1,
      title: 'Conclusion',
      components: [{ id: 'c1', sequence: 1, type: 'COMMENTS', title: 'Comments', config: {} }],
    },
  ],
  responses: {
    expectedVersion: 1,
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
  attachments: [],
};

describe('web Quality execution workflow', () => {
  it.each([
    ['Inline Inspection', 'Inline Inspection Report', 'Inline Inspection'],
    ['Final Inspection', 'Final Inspection Report', 'Final Inspection'],
    [
      'SIZE SET / PRE-PRODUCTION REPORT',
      'Pre-Production Meeting Report',
      'Size Set / Pre-Production Report',
    ],
  ])('renders %s in the shared execution shell', async (activityName, formName, title) => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          ...view,
          activityName,
          qualityForm: { ...view.qualityForm, name: formName },
        },
      },
    });
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

    expect(container.querySelector('[data-quality-execution-shell="true"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe(title);
    expect(container.textContent).toContain(`${formName} v1 · Attempt 1 · DRAFT`);
    const back = container.querySelector('a[aria-label="Back to Job Order JO-2026-000001"]');
    expect(back?.textContent).toContain('←');
    expect(back?.textContent).toContain('Job Order JO-2026-000001');
    expect(back?.getAttribute('href')).toBe('/job-orders/j1');
  });

  it('renders the draft and saves through the optimistic-version endpoint', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: view } });
    const put = vi
      .spyOn(apiClient, 'request')
      .mockResolvedValue({ data: { data: { ...view, version: 2 } } });
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
    expect(container.textContent).toContain('Inline Inspection Report v1');
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Save draft')
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'put',
        url: '/quality-executions/e1',
        data: expect.objectContaining({ expectedVersion: 1 }),
      }),
    );
  });

  it('shows immutable physical-batch history and starts reinspection without new quantities', async () => {
    const failed: QualityExecutionView = {
      ...view,
      status: 'FINALIZED',
      inspectedQuantity: 15,
      responses: {
        ...view.responses,
        outcome: { componentId: 'outcome', value: 'FAIL' },
      },
      finalBatch: {
        id: 'batch-3',
        batchNumber: 3,
        physicalQuantity: 15,
        disposition: 'AWAITING_REINSPECTION',
        allocations: [
          {
            jobOrderLineSizeId: 'size-s',
            sizeCode: 'S',
            sizeLabel: 'Small',
            quantity: 5,
          },
          {
            jobOrderLineSizeId: 'size-m',
            sizeCode: 'M',
            sizeLabel: 'Medium',
            quantity: 10,
          },
        ],
        attempts: [
          {
            id: 'e1',
            attemptNumber: 1,
            status: 'FINALIZED',
            outcome: 'FAIL',
            startedAt: '2026-08-24T00:00:00.000Z',
            finalizedAt: '2026-08-24T01:00:00.000Z',
          },
        ],
        release: null,
      },
    };
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: failed } });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { ...failed, id: 'e2', attemptNumber: 2, status: 'DRAFT' } },
    });
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
    await vi.waitFor(() => expect(container.textContent).toContain('Physical Final batch 3'));
    expect(container.textContent).toContain('S · Small5');
    expect(container.textContent).toContain('Attempt 1FAIL');
    expect(container.querySelector('input[aria-label^="Final batch quantity"]')).toBeNull();
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Start reinspection')
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(post).toHaveBeenCalledWith(
      '/quality-executions/final-batches/batch-3/reinspect',
      undefined,
    );
  });
});
