/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { RetailStoreListPage, RetailStoreDetailPage } from './RetailStorePages.js';
import { RetailStoreLookupField } from './RetailStoreLookupField.js';
const auth = vi.hoisted(() => ({ roles: ['MERCHANDISER'] }));
vi.mock('../../auth/AuthContext.js', () => ({ useAuth: () => ({ user: auth }) }));
const store = {
  id: 's1',
  distributorId: 'd1',
  code: 'S1',
  name: 'Store One',
  distributor: { id: 'd1', code: 'D1', name: 'Distributor One' },
  status: 'ACTIVE',
  addressLine1: '12 Road',
  city: 'Chennai',
  state: 'TN',
  country: 'India',
  postalCode: '600001',
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.roles = ['MERCHANDISER'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(page: React.ReactNode, path = '/') {
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={page} />
            <Route path="/retail-stores/:id" element={page} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}
describe('Retail Store master pages and permissions', () => {
  it('renders paginated list and appends the next page', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockImplementation(async (_url, config) => ({
        data: {
          data: {
            items: config?.params?.cursor
              ? [{ ...store, id: 's2', code: 'S2', name: 'Store Two' }]
              : [store],
            pageInfo: {
              limit: 25,
              hasMore: !config?.params?.cursor,
              nextCursor: config?.params?.cursor ? null : 's1',
            },
          },
        },
      }));
    await render(<RetailStoreListPage />);
    expect(container.textContent).toContain('Store One');
    expect(container.textContent).toContain('Create Retail Store');
    const more = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Load more'),
    )!;
    await act(async () => {
      more.click();
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(container.textContent).toContain('Store One');
    expect(container.textContent).toContain('Store Two');
    expect(get).toHaveBeenCalledWith(
      '/retail-stores',
      expect.objectContaining({ params: expect.objectContaining({ limit: 25, cursor: 's1' }) }),
    );
  });
  it('shows details and changes status through the authorized API', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: store } });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: store } });
    await render(<RetailStoreDetailPage />, '/retail-stores/s1');
    const button = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Inactivate Store',
    )!;
    await act(async () => button.click());
    expect(patch).toHaveBeenCalledWith('/retail-stores/s1/status', { status: 'INACTIVE' });
    expect(container.querySelector('input[value="600001"]')).not.toBeNull();
  });
  it('hides master/inline mutations for read-only roles and displays historical Store values without a master request', async () => {
    auth.roles = ['SENIOR_MANAGEMENT'];
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({
        data: {
          data: { items: [store], pageInfo: { hasMore: false, limit: 25, nextCursor: null } },
        },
      });
    await render(<RetailStoreListPage />);
    expect(container.textContent).not.toContain('Create Retail Store');
    get.mockClear();
    await render(
      <RetailStoreLookupField
        id="s-lookup"
        distributor={store.distributor}
        value={{ id: 'old-inactive', code: 'OLD', name: 'Historical Store' }}
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).not.toContain('+ Create new Retail Store');
    expect(container.querySelector<HTMLInputElement>('input')!.value).toContain('Historical Store');
    expect(get).not.toHaveBeenCalled();
  });
});
