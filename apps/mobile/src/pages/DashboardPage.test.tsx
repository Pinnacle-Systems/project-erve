/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';

vi.mock('../lib/api-client.js', () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from '../lib/api-client.js';
import { DashboardPage } from './DashboardPage.js';

let container: HTMLDivElement;
let root: Root;

function user(roles: Role[]): AuthUser {
  return {
    id: 'user-1',
    email: 'mobile@example.test',
    mobile: null,
    name: 'Mobile User',
    roles,
  };
}

function emptyPage() {
  return { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } };
}

async function renderDashboard(roles: Role[]) {
  vi.mocked(apiClient.get).mockImplementation(async (url) => ({
    data: { success: true, data: url === '/qa/rework' ? [] : emptyPage() },
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  act(() => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <DashboardPage user={user(roles)} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe('mobile role-aware dashboard', () => {
  it('shows factory production entry points to a factory user but no in-system rework lifecycle', async () => {
    // NEW-AUTH-003: there is no ERVE-managed Factory rework lifecycle — rework
    // acknowledge/ready is QA's, not Factory's, so a factory-only user gets no
    // /factory-rework entry point.
    await renderDashboard(['FACTORY_USER']);

    expect(container.querySelector('a[href="/factory-tasks"]')).not.toBeNull();
    expect(container.querySelector('a[href="/factory-rework"]')).toBeNull();
    expect(container.querySelector('a[href="/qa"]')).toBeNull();
  });

  it('shows the QA rework entry point to a QA user', async () => {
    await renderDashboard(['QA_USER']);

    expect(container.querySelector('a[href="/factory-tasks"]')).toBeNull();
    expect(container.querySelector('a[href="/qa"]')).not.toBeNull();
    expect(container.querySelector('a[href="/factory-rework"]')).not.toBeNull();
  });

  it('counts only live active job orders: requests LIVE_WORKFLOW and never counts or lists a historical import', async () => {
    const job = (id: string, status: string, historical: boolean) => ({
      id,
      jobOrderNumber: id,
      status,
      factory: { name: 'Green Way' },
      updatedAt: '2026-09-24T00:00:00Z',
      historicalImport: historical ? { legacyReferenceNumber: 'EI25018', historicalBusinessDate: null, importedAt: null } : null,
      operationalState: { primaryDisplayState: { label: status } },
    });
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/job-orders'
            ? {
                items: [
                  job('HIST-1', 'PRODUCTION_COMPLETE', true),
                  job('LIVE-PC', 'PRODUCTION_COMPLETE', false),
                  job('LIVE-SEW', 'IN_PRODUCTION', false),
                  job('LIVE-CLOSED', 'CLOSED', false),
                ],
                pageInfo: { limit: 50, hasMore: false, nextCursor: null },
              }
            : url === '/qa/rework'
              ? []
              : emptyPage(),
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <DashboardPage user={user(['ADMIN'])} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    const tile = () => container.querySelector('a[href="/job-orders"]');
    await vi.waitFor(() => expect(tile()?.textContent).toContain('2'));
    expect(tile()?.textContent).not.toContain('3');
    const jobOrderCall = vi.mocked(apiClient.get).mock.calls.find((call) => call[0] === '/job-orders');
    expect(jobOrderCall?.[1]).toMatchObject({ params: { recordOrigin: 'LIVE_WORKFLOW' } });
    expect(container.querySelector('a[href="/job-orders/HIST-1"]')).toBeNull();
    expect(container.querySelector('a[href="/job-orders/LIVE-SEW"]')).not.toBeNull();
  });

  it('shows operational monitoring and approval entry points to an administrator', async () => {
    await renderDashboard(['ADMIN']);

    expect(container.querySelector('a[href="/job-orders"]')).not.toBeNull();
    expect(container.querySelector('a[href="/qa"]')).not.toBeNull();
    expect(container.querySelector('a[href="/factory-rework"]')).not.toBeNull();
    expect(container.querySelector('a[href="/qa?filter=IN_PROGRESS"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Inventory and dispatch tracking features');
  });

  it('explains the mobile boundary for a role without an operational workflow', async () => {
    await renderDashboard(['DISTRIBUTOR']);

    expect(container.textContent).toContain('No mobile operational work assigned');
    expect(container.textContent).toContain('web application');
    expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled();
  });
});
