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

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let jobOrderItems: unknown[];

beforeEach(() => {
  // Radix Select needs these for its open/positioning logic in jsdom (see
  // PriceListListPage.test.tsx's precedent).
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jobOrderItems = [];
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/job-orders/factory-options') {
      return { data: { data: [] } };
    }
    if (url.includes('/financial-years')) {
      return { data: { data: [{ id: 'fy-1', code: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' }] } };
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see UserPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function jobOrderSearchCalls(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/job-orders')
    .map((call) => (call[1] as { params?: { search?: string } } | undefined)?.params?.search);
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
        financialYear: { id: 'fy-1', code: '2026-27' },
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

  it('combines QA work and production context into one Status column for QA_USER', async () => {
    jobOrderItems = [
      {
        id: 'job-1',
        jobOrderNumber: 'JO-001',
        financialYear: { id: 'fy-1', code: '2026-27' },
        purchaseOrder: { poNumber: 'PO-001' },
        factory: { name: 'Factory One' },
        processFlowVersion: { versionNumber: 1, processFlow: { name: 'Erve Flow' } },
        status: 'IN_PRODUCTION',
        factoryConfirmationStatus: 'CONFIRMED',
        orderedQuantityTotal: 100,
        preparedQuantityTotal: 0,
        createdAt: '2026-08-21T00:00:00.000Z',
        operationalState: {
          lifecycleContext: { code: 'IN_PRODUCTION', label: 'In Production', tone: 'pending' },
          primaryDisplayState: {
            code: 'PENDING',
            label: 'Inline Inspection Pending',
            tone: 'pending',
            activityId: 'inline',
            activityName: 'Inline Inspection',
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
        },
      },
    ];

    await renderJobOrderListPage('QA_USER');
    await vi.waitFor(() => expect(getPageContent()).toContain('Inline Inspection Available'));
    const qaHeaders = Array.from(container.querySelectorAll('th')).map((item) => item.textContent);
    expect(qaHeaders).toContain('Status');
    expect(qaHeaders).not.toContain('Current State');
    expect(qaHeaders).not.toContain('QA Work');
    expect(getPageContent()).toContain('Production: Sewing In Progress');
    expect(container.querySelectorAll('a[href="/job-orders/job-1"]')).toHaveLength(1);

    act(() => root.unmount());
    container.innerHTML = '';
    root = createRoot(container);
    await renderJobOrderListPage('ADMIN');
    await vi.waitFor(() => expect(getPageContent()).toContain('Inline Inspection Pending'));
    expect(Array.from(container.querySelectorAll('th')).map((item) => item.textContent)).toContain(
      'Current State',
    );
  });

  it('does not add a No QA Action filler for QA_USER', async () => {
    jobOrderItems = [
      {
        id: 'job-1',
        jobOrderNumber: 'JO-001',
        financialYear: { id: 'fy-1', code: '2026-27' },
        purchaseOrder: { poNumber: 'PO-001' },
        factory: { name: 'Factory One' },
        processFlowVersion: { versionNumber: 1, processFlow: { name: 'Erve Flow' } },
        status: 'DRAFT',
        factoryConfirmationStatus: 'PENDING',
        orderedQuantityTotal: 100,
        preparedQuantityTotal: 0,
        createdAt: '2026-08-21T00:00:00.000Z',
        operationalState: {
          lifecycleContext: { code: 'DRAFT', label: 'Draft', tone: 'muted' },
          primaryDisplayState: { code: 'DRAFT', label: 'Draft', tone: 'muted' },
          productionState: null,
          qualityState: null,
        },
      },
    ];

    await renderJobOrderListPage('QA_USER');
    await vi.waitFor(() => expect(getPageContent()).toContain('Draft'));
    expect(getPageContent()).not.toContain('No QA Action');
    expect(Array.from(container.querySelectorAll('th')).map((item) => item.textContent)).toContain(
      'Status',
    );
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

  it('debounces the job order search so rapid typing issues only the final request', async () => {
    await renderJobOrderListPage('ADMIN');

    const requestsBeforeTyping = jobOrderSearchCalls().length;
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search job order or Order Sheet"]',
    )!;

    vi.useFakeTimers();
    for (const value of ['J', 'JO', 'JO-', 'JO-001']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(jobOrderSearchCalls().length).toBe(requestsBeforeTyping);
    expect(input.value).toBe('JO-001');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = jobOrderSearchCalls();
    expect(searches.length).toBe(requestsBeforeTyping + 1);
    expect(searches.at(-1)).toBe('JO-001');
  });

  // UXAUTH-014: QA_USER/SENIOR_MANAGEMENT can list Job Orders but are denied
  // on the broad Factory master — the filter must source its options from
  // /job-orders/factory-options, never /factories directly.
  it.each(['QA_USER', 'SENIOR_MANAGEMENT'] as const)(
    '%s sees the factory filter, sourced from /job-orders/factory-options',
    async (role) => {
      await renderJobOrderListPage(role);
      expect(hasFactoryFilter()).toBe(true);
      expect(apiClient.get).toHaveBeenCalledWith('/job-orders/factory-options');
      expect(apiClient.get).not.toHaveBeenCalledWith('/factories', expect.anything());
    },
  );

  it('shows a visible error, not a silently empty dropdown, when the factory-options request fails', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/job-orders/factory-options') {
        throw new Error('Request failed');
      }
      if (url.includes('/financial-years')) {
        return { data: { data: [] } };
      }
      return { data: { data: { items: jobOrderItems, pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
    });

    await renderJobOrderListPage('ADMIN');
    await vi.waitFor(() => expect(getPageContent()).toContain('Unable to load factories for filtering'));
    expect(hasFactoryFilter()).toBe(true);
  });

  it('labels an inactive factory option "(inactive)" and keeps it selectable, without an ACTIVE-only status filter', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/job-orders/factory-options') {
        return {
          data: {
            data: [
              { id: 'fac-active', code: 'FAC-A', name: 'Active Factory', status: 'ACTIVE' },
              { id: 'fac-inactive', code: 'FAC-I', name: 'Inactive Factory', status: 'INACTIVE' },
            ],
          },
        };
      }
      if (url.includes('/financial-years')) {
        return { data: { data: [] } };
      }
      return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
    });

    await renderJobOrderListPage('ADMIN');

    const optionCall = vi.mocked(apiClient.get).mock.calls.find((call) => call[0] === '/job-orders/factory-options');
    expect(optionCall?.[1]).toBeUndefined();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Factory"]')!;
    await act(async () => trigger.click());
    await waitFor(() => document.body.querySelectorAll('[role="option"]').length > 0);

    const options = Array.from(document.body.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim());
    expect(options).toContain('Active Factory');
    expect(options).toContain('Inactive Factory (inactive)');

    const inactiveOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('Inactive Factory'),
    );
    expect(inactiveOption?.getAttribute('aria-disabled')).not.toBe('true');
  });
});
