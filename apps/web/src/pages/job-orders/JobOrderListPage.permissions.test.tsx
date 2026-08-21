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
let jobOrderItems: unknown[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jobOrderItems = [];
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url.includes('/factories')) {
      return { data: { data: [] } };
    }
    return {
      data: {
        data: {
          items: jobOrderItems,
          pageInfo: { limit: 10, hasMore: false, nextCursor: null },
        },
      },
    };
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
      </QueryClientProvider>,
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
  it('keeps the list compact with one derived Current State column', async () => {
    jobOrderItems = [
      {
        id: 'job-1',
        jobOrderNumber: 'JO-001',
        purchaseOrder: { poNumber: 'PO-001' },
        factory: { name: 'Factory One' },
        processFlowVersion: { versionNumber: 1, processFlow: { name: 'Erve Flow' } },
        status: 'CONFIRMED_BY_FACTORY',
        factoryConfirmationStatus: 'CONFIRMED',
        orderedQuantityTotal: 100,
        preparedQuantityTotal: 0,
        createdAt: '2026-08-21T00:00:00.000Z',
        operationalState: {
          primaryDisplayState: { label: 'Sewing In Progress', tone: 'info' },
          productionState: { label: 'Sewing In Progress', tone: 'info' },
          qualityState: { label: 'Inline Inspection Pending', tone: 'pending' },
        },
      },
    ];
    await renderJobOrderListPage('ADMIN');
    await vi.waitFor(() => expect(getPageContent()).toContain('Sewing In Progress'));
    const headers = Array.from(container.querySelectorAll('th')).map((item) => item.textContent);
    expect(headers).toContain('Current State');
    expect(headers).not.toContain('Workflow');
    expect(headers).not.toContain('Production');
    expect(headers).not.toContain('Quality');
    expect(headers).not.toContain('Lifecycle');
    expect(getPageContent()).not.toContain('Inline Inspection Pending');
    expect(container.querySelector('[aria-label="Lifecycle"]')).not.toBeNull();
  });

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
    expect(apiClient.get).toHaveBeenCalledWith(
      '/job-orders',
      expect.not.objectContaining({
        params: expect.objectContaining({
          factoryId: expect.anything(),
        }),
      }),
    );
  });
});
