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
  it('shows factory production and rework entry points to a factory user', async () => {
    await renderDashboard(['FACTORY_USER']);

    expect(container.querySelector('a[href="/factory-tasks"]')).not.toBeNull();
    expect(container.querySelector('a[href="/factory-rework"]')).not.toBeNull();
    expect(container.querySelector('a[href="/qa"]')).toBeNull();
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
