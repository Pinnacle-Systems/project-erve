/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { PurchaseOrderListPage } from './PurchaseOrderListPage.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const user: AuthUser = {
    id: 'admin-1',
    email: 'admin@test.local',
    mobile: null,
    name: 'Admin',
    roles: ['ADMIN'],
  };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
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
  vi.useRealTimers();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see UserPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function purchaseOrderSearchCalls(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/purchase-orders')
    .map((call) => (call[1] as { params?: { search?: string } } | undefined)?.params?.search);
}

async function renderPage() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/distributors/options') {
      return {
        data: {
          data: [{ id: 'dist-1', code: 'DIST-1', name: 'Acme Distribution', status: 'ACTIVE', purchaseMode: 'OUTRIGHT' }],
        },
      };
    }
    if (url === '/financial-years') return { data: { data: [] } };
    if (url === '/purchase-orders') {
      return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PurchaseOrderListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('PurchaseOrderListPage search debounce', () => {
  it('debounces the purchase order search so rapid typing issues only the final request', async () => {
    await renderPage();

    const requestsBeforeTyping = purchaseOrderSearchCalls().length;
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search Order Sheet number"]',
    )!;

    vi.useFakeTimers();
    for (const value of ['E', 'EI', 'EIO', 'EIOS', 'EIOS/', 'EIOS/2', 'EIOS/26']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(purchaseOrderSearchCalls().length).toBe(requestsBeforeTyping);
    expect(input.value).toBe('EIOS/26');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = purchaseOrderSearchCalls();
    expect(searches.length).toBe(requestsBeforeTyping + 1);
    expect(searches.at(-1)).toBe('EIOS/26');
  });
});

function purchaseOrderDistributorFilters(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/purchase-orders')
    .map((call) => (call[1] as { params?: { distributorId?: string } } | undefined)?.params?.distributorId);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe('PurchaseOrderListPage Distributor filter (P1L5)', () => {
  it('filters by a Distributor picked from the bounded lookup and clears with Clear filters', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    await renderPage();

    const calls = () => vi.mocked(apiClient.get).mock.calls.map((call) => call[0]);
    // Nothing distributor-related loads until the filter is searched.
    expect(calls()).not.toContain('/distributors');
    expect(calls()).not.toContain('/distributors/options');
    expect(purchaseOrderDistributorFilters().at(-1)).toBeUndefined();

    const input = document.getElementById('order-sheet-distributor-filter') as HTMLInputElement;
    expect(input.placeholder).toBe('All distributors');
    await act(async () => {
      input.focus();
      setInputValue(input, 'acme');
    });
    await waitUntil(() => document.body.querySelector('[role="option"]') !== null);
    const search = vi.mocked(apiClient.get).mock.calls.find((call) => call[0] === '/distributors/options');
    expect(search?.[1]).toMatchObject({ params: { search: 'acme', limit: 20 } });

    await act(async () => document.body.querySelector<HTMLElement>('[role="option"]')!.click());
    await waitUntil(() => purchaseOrderDistributorFilters().at(-1) === 'dist-1');
    expect(input.value).toBe('Acme Distribution');

    const clearFilters = Array.from(container.querySelectorAll('button')).find((button) =>
      /clear/i.test(button.textContent ?? ''),
    )!;
    await act(async () => clearFilters.click());
    await waitUntil(() => purchaseOrderDistributorFilters().at(-1) === undefined);
    expect(input.value).toBe('');
    expect(calls()).not.toContain('/distributors');
  });
});
