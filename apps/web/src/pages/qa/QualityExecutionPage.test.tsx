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
});
