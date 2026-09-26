/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser } from '@erve/types';
import { JobOrderListPage } from './JobOrderListPage.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';

// RPT3 8.9.A — a Dashboard drilldown link (e.g. "Delayed Job Orders") lands
// here with URL query params that must initialize this page's own filters,
// not just be ignored.

let container: HTMLDivElement;
let root: Root;
let listCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  listCalls = [];
  vi.spyOn(apiClient, 'get').mockImplementation(
    async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === '/job-orders/factory-options') return { data: { data: [] } };
      if (url.includes('/financial-years')) return { data: { data: [] } };
      listCalls.push(config?.params ?? {});
      return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    },
  );
  const user: AuthUser = { id: 'u1', email: 'admin@test.local', mobile: null, name: 'Admin', roles: ['ADMIN'] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderAt(path: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <JobOrderListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('JobOrderListPage drilldown filters (RPT3 8.9.A)', () => {
  it('sends delayed=true from a ?delayed=true URL', async () => {
    await renderAt('/job-orders?delayed=true');
    expect(listCalls.at(-1)).toMatchObject({ delayed: true });
  });

  it('sends recordOrigin from a ?recordOrigin=HISTORICAL_IMPORT URL', async () => {
    await renderAt('/job-orders?recordOrigin=HISTORICAL_IMPORT');
    expect(listCalls.at(-1)).toMatchObject({ recordOrigin: 'HISTORICAL_IMPORT' });
  });

  it('seeds the status filter from a ?status=IN_PRODUCTION URL', async () => {
    await renderAt('/job-orders?status=IN_PRODUCTION');
    expect(listCalls.at(-1)).toMatchObject({ status: 'IN_PRODUCTION' });
  });
});
