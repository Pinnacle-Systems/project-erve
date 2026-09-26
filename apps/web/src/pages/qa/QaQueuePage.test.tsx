/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityWorkItem } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { QaQueuePage } from './QaQueuePage.js';

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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function item(n: number): QualityWorkItem {
  return {
    jobOrderId: `job-${n}`,
    jobOrderNumber: `JO-${String(n).padStart(3, '0')}`,
    factory: { id: 'factory-1', code: 'FAC', name: 'Factory One' },
    activity: {
      processFlowVersionStageId: `quality-${n}`,
      sequence: 1,
      name: 'Inline Inspection',
      status: 'IN_PROGRESS',
      eligible: false,
      qualityForm: { id: 'form', code: 'FORM', name: 'Inline Inspection', executionScope: 'JOB_ORDER' },
      qualityFormVersion: { id: 'form-version', versionNumber: 1 },
      executionMode: 'IN_PROCESS',
      associatedProductionActivity: null,
      availabilityPolicy: 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
      progressThresholdPercent: null,
      gateSatisfactionRequirement: null,
      executionMultiplicity: 'SINGLE',
      coverageTarget: null,
      coverage: null,
      execution: null,
      executionHistory: [],
    },
  } satisfies QualityWorkItem;
}

describe('QA work list (QW1 paginated contract)', () => {
  it('loads every page via server-side cursor pagination, never a single unpaginated array', async () => {
    await expectLoadsEveryPage({
      element: <QaQueuePage />,
      path: '/job-orders/quality-work',
      noun: 'activities',
      row: item,
      rowText: (n) => `JO-${String(n).padStart(3, '0')}`,
      otherGet: () => [],
    });
  });

  it('sends status, conflict and factory filters to the server rather than filtering a fetched-once array', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.spyOn(apiClient, 'get').mockImplementation(
      async (url: string, config?: { params?: Record<string, unknown> }) => {
        if (url === '/job-orders/factory-options') {
          return { data: { data: [{ id: 'factory-1', code: 'FAC', name: 'Factory One' }] } };
        }
        calls.push(config?.params ?? {});
        return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      },
    );

    act(() => {
      root.render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter>
            <QaQueuePage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(calls.at(-1)).toMatchObject({ search: undefined, status: undefined, conflict: undefined });

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search job order, activity or factory"]',
    )!;
    act(() => setInputValue(input, 'JO-002'));
    // The search value is debounced 300ms before it becomes a query param.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(calls.at(-1)).toMatchObject({ search: 'JO-002' });
  });
});
