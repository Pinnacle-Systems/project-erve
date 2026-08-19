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
  activityName: 'Final Inspection',
  qualityForm: {
    id: 'f1',
    code: 'FINAL',
    name: 'Final Inspection Report',
    versionId: 'v1',
    versionNumber: 1,
  },
  attemptNumber: 1,
  batchNumber: 1,
  inspectedQuantity: null,
  ppSample: null,
  coverage: null,
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
  attachments: [],
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
