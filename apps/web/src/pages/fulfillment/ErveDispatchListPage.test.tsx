/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { ErveDispatchListPage } from './ErveDispatchListPage.js';

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

const content = () => container.textContent ?? '';

function renderPage() {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/erve-dispatches']}>
          <AuthProvider>
            <Routes>
              <Route path="/fulfillment/erve-dispatches" element={<ErveDispatchListPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('ErveDispatchListPage status (BUG-008)', () => {
  it('renders the same Dispatched and Delivered status badges as the detail page', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        data: {
          items: [
            {
              id: 'dispatch-1',
              erveDispatchNumber: 'EIED/26-27/0001',
              status: 'DISPATCHED',
              saleOrder: { saleOrderNumber: 'EISO/26-27/0001' },
              distributor: { name: 'Distributor One' },
              dispatchDate: '2026-10-01T00:00:00.000Z',
              transporter: null,
              lrNumber: null,
              totalQuantity: 12,
            },
            {
              id: 'dispatch-2',
              erveDispatchNumber: 'EIED/26-27/0002',
              status: 'DELIVERED',
              saleOrder: null,
              distributor: { name: 'Distributor Two' },
              dispatchDate: '2026-10-02T00:00:00.000Z',
              transporter: 'Carrier',
              lrNumber: 'LR-2',
              totalQuantity: 4,
            },
          ],
          pageInfo: { limit: 50, hasMore: false, nextCursor: null },
        },
      },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).toContain('EIED/26-27/0002'));

    const headers = Array.from(container.querySelectorAll('th')).map((header) => header.textContent);
    expect(headers).toContain('Status');
    expect(content()).toContain('Dispatched');
    expect(content()).toContain('Delivered');
  });
});


describe('BUG-008 Dispatch History server-side status filters', () => {
  it('requests each status separately and starts again at the first cursor on filter changes', async () => {
    const get = vi.spyOn(apiClient, 'get').mockImplementation(async (_url, options) => {
      const status = (options as { params?: { status?: string } })?.params?.status;
      return {
        data: { data: {
          items: [{
            id: status ?? 'all',
            erveDispatchNumber: status === 'DELIVERED' ? 'EIED/26-27/0003' :
              status === 'DISPATCHED' ? 'EIED/26-27/0002' : 'EIED/26-27/0001',
            status: status ?? 'DISPATCHED',
            saleOrder: null, distributor: { name: 'Distributor One' },
            dispatchDate: '2026-10-01T00:00:00Z', transporter: null, lrNumber: null, totalQuantity: 12,
          }],
          pageInfo: { limit: 50, hasMore: false, nextCursor: null },
        } },
      } as never;
    });
    renderPage();
    await vi.waitFor(() => expect(content()).toContain('EIED/26-27/0001'));
    const buttons = Array.from(container.querySelectorAll('[role="group"] button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['All', 'Dispatched', 'Delivered']);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');

    act(() => (buttons[2] as HTMLButtonElement).click());
    await vi.waitFor(() => expect(content()).toContain('EIED/26-27/0003'));
    expect(content()).not.toContain('EIED/26-27/0001');
    expect(get).toHaveBeenCalledWith('/erve-dispatches', { params: { limit: 50, status: 'DELIVERED', cursor: undefined } });
    expect(buttons[2]?.getAttribute('aria-pressed')).toBe('true');

    act(() => (buttons[1] as HTMLButtonElement).click());
    await vi.waitFor(() => expect(content()).toContain('EIED/26-27/0002'));
    expect(content()).not.toContain('EIED/26-27/0003');
    expect(get).toHaveBeenCalledWith('/erve-dispatches', { params: { limit: 50, status: 'DISPATCHED', cursor: undefined } });
    act(() => (buttons[0] as HTMLButtonElement).click());
    await vi.waitFor(() => expect(content()).toContain('EIED/26-27/0001'));
    expect(get).toHaveBeenCalledWith('/erve-dispatches', { params: { limit: 50, status: undefined, cursor: undefined } });
  });
});

describe('ErveDispatchListPage — request failure handling (UXAUTH-018)', () => {
  it('shows a visible error, not a silent empty list, when the request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Network Error'));

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading dispatch history'));

    expect(content()).not.toContain('No dispatches yet');
    expect(content()).toContain('Unable to load dispatch history');
    expect(content()).toContain('Network Error');
  });

  it('renders an empty-list state (not an error) when the request succeeds with zero records', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { data: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } },
    } as never);

    renderPage();
    await vi.waitFor(() => expect(content()).not.toContain('Loading dispatch history'));

    expect(content()).toContain('No dispatches yet');
    expect(content()).not.toContain('Unable to load dispatch history');
  });
});
