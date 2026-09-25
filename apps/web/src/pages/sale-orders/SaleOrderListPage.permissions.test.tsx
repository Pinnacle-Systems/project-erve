/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser, Role } from '@erve/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SaleOrderListPage } from './SaleOrderListPage.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;

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
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/sale-orders/distributor-options') return { data: { data: [] } };
    if (url === '/sale-orders/factory-options') return { data: { data: [] } };
    if (url === '/sale-orders') {
      return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
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

const renderSaleOrderListPage = async (role: Role) => {
  const user: AuthUser = { id: 'user-1', email: 'test@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SaleOrderListPage />
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

// Types into the Distributor filter lookup and waits for its fresh results
// (it debounces before searching, so this polls with real timers).
async function searchDistributorFilter(text: string): Promise<void> {
  const input = document.getElementById('dispatch-order-distributor-filter') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    input.focus();
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const deadline = Date.now() + 3000;
  while (!document.body.querySelector('[data-lookup-panel] [role="status"]')?.textContent?.match(/result|match|Unable|failed/i)) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the lookup');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function hasDistributorFilter(): boolean {
  return container.querySelector('[aria-label="Distributor"]') !== null;
}

// Dispatch Order Phase 3: DISTRIBUTOR has no Dispatch Order role at all —
// no Create action, no filters, no list access in practice (route-gated
// separately; this component-level test covers the in-page affordances).
describe('SaleOrderListPage Permissions', () => {
  it('ACCOUNTANT can open the list, sees the filters (read-only), but no Create action', async () => {
    await renderSaleOrderListPage('ACCOUNTANT');
    expect(getPageContent()).not.toContain('Create Dispatch Order');
    expect(hasDistributorFilter()).toBe(true);
  });

  it('DISTRIBUTOR sees no Create action and no filters', async () => {
    await renderSaleOrderListPage('DISTRIBUTOR');
    expect(getPageContent()).not.toContain('Create Dispatch Order');
    expect(hasDistributorFilter()).toBe(false);
  });

  it('MERCHANDISER sees both the distributor filter and the Create action', async () => {
    await renderSaleOrderListPage('MERCHANDISER');
    expect(hasDistributorFilter()).toBe(true);
    expect(getPageContent()).toContain('Create Dispatch Order');
  });

  it('FACTORY_USER sees the list (scoped server-side to its own Factory) but no Create action', async () => {
    await renderSaleOrderListPage('FACTORY_USER');
    expect(getPageContent()).not.toContain('Create Dispatch Order');
  });

  // Regression test for a Phase 3 smoke-check finding: showFilters was
  // wired to canViewDispatchOrders, which is true for every role that can
  // even see this page (FACTORY_USER included) - so the merchandiser-
  // oriented Distributor/Factory filter pickers incorrectly appeared for a
  // read-only, single-Factory-scoped FACTORY_USER too. Now gated by the
  // narrower canFilterDispatchOrders, which excludes FACTORY_USER.
  it('FACTORY_USER does not see the Distributor/Factory filter pickers', async () => {
    await renderSaleOrderListPage('FACTORY_USER');
    expect(hasDistributorFilter()).toBe(false);
  });

  // UXAUTH-015: ACCOUNTANT is denied on both broad masters, SENIOR_MANAGEMENT
  // on the Factory master — the filters must source their options from the
  // Dispatch-Order-specific lookups, never /distributors or /factories
  // directly, and both roles must get both filters through the same
  // transaction-specific endpoints rather than a mix of master/transaction
  // sources.
  it.each(['ACCOUNTANT', 'SENIOR_MANAGEMENT'] as const)(
    '%s sees both filters, sourced from /sale-orders/factory-options and /sale-orders/distributor-options',
    async (role) => {
      await renderSaleOrderListPage(role);
      expect(hasDistributorFilter()).toBe(true);
      expect(apiClient.get).toHaveBeenCalledWith('/sale-orders/factory-options');
      // The Distributor filter is a lookup: nothing loads until it is searched.
      expect(apiClient.get).not.toHaveBeenCalledWith('/sale-orders/distributor-options', expect.anything());
      await searchDistributorFilter('dist');
      expect(apiClient.get).toHaveBeenCalledWith(
        '/sale-orders/distributor-options',
        expect.objectContaining({ params: { search: 'dist', limit: 20 } }),
      );
      expect(apiClient.get).not.toHaveBeenCalledWith('/factories', expect.anything());
      expect(apiClient.get).not.toHaveBeenCalledWith('/distributors', expect.anything());
    },
  );

  it('shows a visible error for the Factory filter, not a silently empty dropdown, when factory-options fails', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/factory-options') throw new Error('Request failed');
      if (url === '/sale-orders/distributor-options') return { data: { data: [] } };
      if (url === '/sale-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await renderSaleOrderListPage('ACCOUNTANT');
    await vi.waitFor(() => expect(getPageContent()).toContain('Unable to load factories for filtering'));
  });

  it('shows a visible error for the Distributor filter, not a silently empty dropdown, when distributor-options fails', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/distributor-options') throw new Error('Request failed');
      if (url === '/sale-orders/factory-options') return { data: { data: [] } };
      if (url === '/sale-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await renderSaleOrderListPage('ACCOUNTANT');
    await searchDistributorFilter('dist');
    expect(document.body.querySelector('[data-lookup-panel] [role="status"]')?.textContent).toBe('Request failed');
  });

  it('labels inactive Factory/Distributor options "(inactive)" and keeps them selectable, without an ACTIVE-only status filter', async () => {
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/sale-orders/factory-options') {
        return {
          data: {
            data: [
              { id: 'fac-active', code: 'FAC-A', name: 'Active Factory', status: 'ACTIVE' },
              { id: 'fac-inactive', code: 'FAC-I', name: 'Inactive Factory', status: 'INACTIVE' },
            ],
          },
        };
      }
      if (url === '/sale-orders/distributor-options') {
        return {
          data: {
            data: [
              { id: 'dist-active', code: 'DIST-A', name: 'Active Distributor', status: 'ACTIVE' },
              { id: 'dist-inactive', code: 'DIST-I', name: 'Old Traders', status: 'INACTIVE' },
            ],
          },
        };
      }
      if (url === '/sale-orders') {
        return { data: { data: { items: [], pageInfo: { limit: 10, hasMore: false, nextCursor: null } } } };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await renderSaleOrderListPage('ACCOUNTANT');

    const factoryOptionCall = vi.mocked(apiClient.get).mock.calls.find((call) => call[0] === '/sale-orders/factory-options');
    const distributorOptionCall = vi
      .mocked(apiClient.get)
      .mock.calls.find((call) => call[0] === '/sale-orders/distributor-options');
    expect(factoryOptionCall?.[1]).toBeUndefined();
    // Not searched yet.
    expect(distributorOptionCall).toBeUndefined();

    const factoryTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Factory"]')!;
    await act(async () => factoryTrigger.click());
    await waitFor(() => document.body.querySelectorAll('[role="option"]').length > 0);
    let options = Array.from(document.body.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim());
    expect(options).toContain('Active Factory');
    expect(options).toContain('Inactive Factory (inactive)');

    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    await searchDistributorFilter('dist');
    const distributorSearch = vi
      .mocked(apiClient.get)
      .mock.calls.find((call) => call[0] === '/sale-orders/distributor-options');
    expect((distributorSearch?.[1] as { params: Record<string, unknown> }).params).toEqual({ search: 'dist', limit: 20 });
    options = Array.from(document.body.querySelectorAll('[role="option"]')).map((el) => el.textContent?.trim());
    expect(options).toContain('Active DistributorDIST-A');
    expect(options).toContain('Old TradersDIST-I(inactive)');
  });
});
