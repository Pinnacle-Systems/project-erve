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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/distributors') return { data: { data: [] } };
    if (url === '/factories') return { data: { data: [] } };
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
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
});
