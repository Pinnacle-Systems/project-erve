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
