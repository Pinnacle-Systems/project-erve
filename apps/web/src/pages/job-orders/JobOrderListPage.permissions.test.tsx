/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser, Role } from '@erve/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobOrderListPage } from './JobOrderListPage.js';
import * as AuthContext from '../../auth/AuthContext.js';

import { apiClient } from '../../lib/api-client.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/factories')) {
      return { data: { data: [] } };
    }
    return { data: { data: { items: [], total: 0, page: 1, limit: 10 } } };
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const renderJobOrderListPage = async (role: Role, initialUrl = '/job-orders') => {
  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };

  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <JobOrderListPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });
  
  await act(async () => {
    await flushMicrotasks();
  });
};

function getPageContent(): string {
  return container.textContent ?? '';
}

function hasFactoryFilter(): boolean {
  return Array.from(container.querySelectorAll('button')).some((el) => {
    return el.getAttribute('aria-label') === 'Factory' || el.textContent === 'All factories';
  });
}

describe('JobOrderListPage Permissions', () => {
  it('ADMIN sees Create Job Order button and factory filter', async () => {
    await renderJobOrderListPage('ADMIN');
    expect(getPageContent()).toContain('Create Job Order');
    expect(hasFactoryFilter()).toBe(true);
  });

  it('MERCHANDISER sees Create Job Order button and factory filter', async () => {
    await renderJobOrderListPage('MERCHANDISER');
    expect(getPageContent()).toContain('Create Job Order');
    expect(hasFactoryFilter()).toBe(true);
  });

  it('FACTORY_USER does not see Create Job Order button or factory filter', async () => {
    await renderJobOrderListPage('FACTORY_USER');
    expect(getPageContent()).not.toContain('Create Job Order');
    expect(hasFactoryFilter()).toBe(false);
  });

  it('removes unauthorized factoryId from URL for FACTORY_USER and omits it from API request', async () => {
    await renderJobOrderListPage('FACTORY_USER', '/job-orders?factoryId=some-factory');
    expect(hasFactoryFilter()).toBe(false);

    // Ensure the API call did not include factoryId even though it was in the URL
    expect(apiClient.get).toHaveBeenCalledWith('/job-orders', expect.not.objectContaining({
      params: expect.objectContaining({
        factoryId: expect.anything(),
      }),
    }));
  });
});
