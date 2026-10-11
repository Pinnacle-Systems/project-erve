/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as Auth from '../../auth/AuthContext.js';
import { TaxInvoiceListPage } from './TaxInvoiceListPage.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(role: Role = 'ACCOUNTANT') {
  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };
  vi.spyOn(Auth, 'useAuth').mockReturnValue({
    user,
    isInitializing: false,
  } as unknown as ReturnType<typeof Auth.useAuth>);
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <TaxInvoiceListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
describe('Tax Invoice queue', () => {
  it('loads only server pages and follows the supplied cursor', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockImplementation(async (_url, config) => ({
        data: {
          data: {
            items: [taxInvoiceFixture({ id: config?.params?.cursor ? 'inv-2' : 'inv-1' })],
            pageInfo: {
              limit: 25,
              hasMore: !config?.params?.cursor,
              nextCursor: config?.params?.cursor ? null : 'next-1',
            },
          },
        },
      }));
    await render();
    await vi.waitFor(() => expect(container.textContent).toContain('Buyer One'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Not finalized');
    const loadMore = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Load more'),
    )!;
    await act(async () => loadMore.click());
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(get.mock.calls[1]?.[1]?.params).toMatchObject({ cursor: 'next-1', limit: 25 });
  });
  it('reports API failure instead of pretending the queue is empty', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Invoice service unavailable'));
    await render();
    await vi.waitFor(() => expect(container.textContent).toContain('Unable to load Tax Invoices'));
    expect(container.textContent).not.toContain('No Tax Invoices');
  });
  it('does not expose draft creation to ADMIN', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } },
    });
    await render('ADMIN');
    await vi.waitFor(() => expect(container.textContent).toContain('No Tax Invoices'));
    expect(container.textContent).not.toContain('Create draft');
  });
});
