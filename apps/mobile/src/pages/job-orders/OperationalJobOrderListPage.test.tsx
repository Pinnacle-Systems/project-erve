/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JobOrderDetail } from '@erve/types';

vi.mock('../../lib/api-client.js', () => ({ apiClient: { get: vi.fn() } }));

import { apiClient } from '../../lib/api-client.js';
import { OperationalJobOrderListPage } from './OperationalJobOrderListPage.js';

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

describe('mobile operational Job Order list', () => {
  it('shows one compact derived Current State instead of duplicate lanes or stale lifecycle', async () => {
    const job = {
      id: 'job-1',
      jobOrderNumber: 'JO-001',
      status: 'CONFIRMED_BY_FACTORY',
      factory: { name: 'Factory One' },
      sourceOrderSheetCount: 1,
      orderedQuantityTotal: 100,
      preparedQuantityTotal: 0,
      operationalState: {
        lifecycleContext: {
          code: 'CONFIRMED_BY_FACTORY',
          label: 'Factory Confirmed',
          tone: 'pending',
          activityId: null,
          activityName: null,
        },
        productionState: {
          code: 'IN_PROGRESS',
          label: 'Sewing In Progress',
          tone: 'info',
          activityId: 'sewing',
          activityName: 'Sewing',
        },
        qualityState: {
          code: 'PENDING',
          label: 'Inline Inspection Pending',
          tone: 'pending',
          activityId: 'inline',
          activityName: 'Inline Inspection',
        },
        primaryDisplayState: {
          code: 'IN_PROGRESS',
          label: 'Sewing In Progress',
          tone: 'info',
          activityId: 'sewing',
          activityName: 'Sewing',
        },
      },
    } as JobOrderDetail;
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        success: true,
        data: { items: [job], pageInfo: { limit: 50, hasMore: false, nextCursor: null } },
      },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OperationalJobOrderListPage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await vi.waitFor(() => expect(container.textContent).toContain('Sewing In Progress'));
    expect(container.textContent).not.toContain('Production: Sewing In Progress');
    expect(container.textContent).not.toContain('Inline Inspection Pending');
    expect(container.textContent).not.toContain('CONFIRMED BY FACTORY');
  });

  it('is live operational work only: requests LIVE_WORKFLOW, excludes a historical import, keeps a live PRODUCTION_COMPLETE and its recorded 0', async () => {
    const base = {
      factory: { name: 'Green Way' },
      sourceOrderSheetCount: 0,
      orderedQuantityTotal: 1008,
      preparedQuantityTotal: 0,
      operationalState: { primaryDisplayState: { code: 'COMPLETED', label: 'Production Complete', tone: 'success', activityId: null, activityName: null } },
    };
    const historical = {
      ...base,
      id: 'hist',
      jobOrderNumber: 'EIJOH/26-27/0109',
      status: 'PRODUCTION_COMPLETE',
      historicalImport: { legacyReferenceNumber: 'EI25018', historicalBusinessDate: '2025-08-15', importedAt: '2026-09-24T00:00:00Z' },
    } as unknown as JobOrderDetail;
    const live = { ...base, id: 'live', jobOrderNumber: 'EIJO/26-27/0001', status: 'PRODUCTION_COMPLETE', historicalImport: null } as unknown as JobOrderDetail;
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { success: true, data: { items: [historical, live], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OperationalJobOrderListPage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    // The API is asked for live rows only; the historical row returned anyway
    // here proves the client-side guard as well.
    await vi.waitFor(() => expect(container.querySelectorAll('a')).toHaveLength(1));
    expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[1]).toMatchObject({ params: { recordOrigin: 'LIVE_WORKFLOW' } });
    expect(container.querySelector('a[href="/job-orders/hist"]')).toBeNull();
    expect(container.textContent).not.toContain('EIJOH/26-27/0109');
    const liveCard = container.querySelector('a[href="/job-orders/live"]')!.textContent ?? '';
    expect(liveCard).toContain('Production Complete');
    expect(liveCard).toContain('Prepared 0 of 1008');
  });

  it('follows the cursor with Load more, and never claims "none" while more pages exist', async () => {
    const liveJob = (n: number, status = 'CONFIRMED_BY_FACTORY') =>
      ({
        id: `job-${n}`,
        jobOrderNumber: `EIJO/26-27/${String(n).padStart(4, '0')}`,
        status,
        factory: { name: 'Factory One' },
        sourceOrderSheetCount: 1,
        orderedQuantityTotal: 10,
        preparedQuantityTotal: 0,
        historicalImport: null,
        operationalState: { primaryDisplayState: { label: 'Sewing In Progress' } },
      }) as unknown as JobOrderDetail;
    const page = (items: JobOrderDetail[], nextCursor: string | null) => ({
      data: { success: true, data: { items, pageInfo: { limit: 50, hasMore: nextCursor !== null, nextCursor } } },
    });
    vi.mocked(apiClient.get).mockImplementation(async (_url, config) =>
      (config as { params?: { cursor?: string } } | undefined)?.params?.cursor === 'c1'
        ? page([liveJob(2)], null)
        : // A first page whose rows are all inactive must not read as "no active job orders".
          page([liveJob(1, 'CLOSED')], 'c1'),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <OperationalJobOrderListPage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    const loadMore = () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Load more');
    await vi.waitFor(() => expect(loadMore()).toBeDefined());
    expect(container.textContent).not.toContain('No active job orders match this view.');

    act(() => loadMore()!.click());
    await vi.waitFor(() => expect(container.textContent).toContain('EIJO/26-27/0002'));
    expect(vi.mocked(apiClient.get).mock.calls.at(-1)?.[1]).toMatchObject({
      params: { cursor: 'c1', recordOrigin: 'LIVE_WORKFLOW', limit: 50 },
    });
    expect(container.textContent).not.toContain('EIJO/26-27/0001');
    expect(loadMore()).toBeUndefined();
  });
});
