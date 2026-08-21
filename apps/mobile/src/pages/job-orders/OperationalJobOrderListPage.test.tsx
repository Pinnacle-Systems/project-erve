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
      purchaseOrder: { poNumber: 'PO-001' },
      factory: { name: 'Factory One' },
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
});
