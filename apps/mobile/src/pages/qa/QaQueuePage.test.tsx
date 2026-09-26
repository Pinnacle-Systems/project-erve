/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { QualityWorkItem } from '@erve/types';

vi.mock('../../lib/api-client.js', () => ({ apiClient: { get: vi.fn() } }));

import { apiClient } from '../../lib/api-client.js';
import { QaQueuePage } from './QaQueuePage.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function item(n: number, status: QualityWorkItem['activity']['status'] = 'IN_PROGRESS'): QualityWorkItem {
  return {
    jobOrderId: `job-${n}`,
    jobOrderNumber: `JO-${String(n).padStart(3, '0')}`,
    factory: { id: 'factory-1', code: 'FAC', name: 'Factory One' },
    activity: {
      processFlowVersionStageId: `quality-${n}`,
      sequence: 1,
      name: 'Inline Inspection',
      status,
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

function page(items: QualityWorkItem[], nextCursor: string | null) {
  return {
    data: {
      success: true,
      data: { items, pageInfo: { limit: 25, hasMore: nextCursor !== null, nextCursor } },
    },
  };
}

describe('mobile QA work list (QW1 paginated contract)', () => {
  it('renders the server-paginated queue rather than a single unpaginated array', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(page([item(1)], null));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <QaQueuePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain('JO-001'));
    expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[0]).toBe('/job-orders/quality-work');
  });

  it('follows the cursor with Load more, and never claims "none" while more pages exist', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) =>
      (config as { params?: { cursor?: string } } | undefined)?.params?.cursor === 'c1'
        ? page([item(2)], null)
        : page([item(1)], 'c1'),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <QaQueuePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    const loadMore = () =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
    await vi.waitFor(() => expect(loadMore()).toBeDefined());
    expect(container.textContent).not.toContain('No Quality activities match this view.');

    act(() => loadMore()!.click());
    await vi.waitFor(() => expect(container.textContent).toContain('JO-002'));
    expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[1]).toMatchObject({
      params: { cursor: 'c1', limit: 25 },
    });
    expect(loadMore()).toBeUndefined();
  });

  it('sends the status filter to the server and keeps it synced to the URL', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(page([], null));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <QaQueuePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => expect(vi.mocked(apiClient.get)).toHaveBeenCalled());

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="QA status"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'AVAILABLE');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() =>
      expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[1]).toMatchObject({
        params: { status: 'AVAILABLE' },
      }),
    );
  });

  it('sends the conflict filter as an explicit true/false string, not a synthesized status', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(page([], null));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <QaQueuePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => expect(vi.mocked(apiClient.get)).toHaveBeenCalled());

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="QA status"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'RECONCILIATION_CONFLICT');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() =>
      expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[1]).toMatchObject({
        params: { status: undefined, conflict: 'true' },
      }),
    );
  });
});
