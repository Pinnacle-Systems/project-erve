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

describe('SaleOrderListPage Permissions', () => {
  it('ACCOUNTANT can open the list, but sees no Create action or distributor filter', async () => {
    await renderSaleOrderListPage('ACCOUNTANT');
    expect(getPageContent()).not.toContain('Create Sale Order');
    expect(hasDistributorFilter()).toBe(false);
  });

  it('DISTRIBUTOR sees the Create action (unchanged)', async () => {
    await renderSaleOrderListPage('DISTRIBUTOR');
    expect(getPageContent()).toContain('Create Sale Order');
  });

  it('MERCHANDISER sees the distributor filter (unchanged)', async () => {
    await renderSaleOrderListPage('MERCHANDISER');
    expect(hasDistributorFilter()).toBe(true);
    expect(getPageContent()).not.toContain('Create Sale Order');
  });
});
