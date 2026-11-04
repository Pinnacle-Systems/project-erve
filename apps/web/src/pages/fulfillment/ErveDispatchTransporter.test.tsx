/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import * as AuthContext from '../../auth/AuthContext.js';
import { apiClient } from '../../lib/api-client.js';
import { ErveDispatchDetailPage } from './ErveDispatchDetailPage.js';
import { ErveDispatchListPage } from './ErveDispatchListPage.js';
let container: HTMLDivElement;
let root: Root;
const transport = {
  id: 'ed',
  erveDispatchNumber: 'ED-1',
  status: 'DISPATCHED',
  version: 3,
  dispatchDate: '2026-11-01',
  transporter: 'Carrier',
  vehicleNumber: null,
  lrNumber: null,
  lrUpdatedAt: null,
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: { id: 't1', roles: ['TRANSPORTER'] } as AuthUser,
  } as ReturnType<typeof AuthContext.useAuth>);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url === '/erve-dispatches/ed/transport') return { data: { data: transport } };
    if (url === '/erve-dispatches/assigned-transport')
      return {
        data: {
          data: { items: [transport], pageInfo: { hasMore: false, nextCursor: null, limit: 25 } },
        },
      };
    throw new Error(`Forbidden full-detail fetch: ${url}`);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render(path = '/fulfillment/erve-dispatches/ed') {
  act(() =>
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/fulfillment/erve-dispatches" element={<ErveDispatchListPage />} />
            <Route path="/fulfillment/erve-dispatches/:id" element={<ErveDispatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).not.toMatch(/Loading/));
}
function button(text: string) {
  return [...container.querySelectorAll('button')].find((el) => el.textContent === text)!;
}
function editLr(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[name="lrNumber"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
it.each(['', '?tab=overview', '?tab=distributor-receipt'])(
  'forces the restricted transport tab for %s without fetching full detail',
  async (suffix) => {
    await render('/fulfillment/erve-dispatches/ed' + suffix);
    expect(container.textContent).toContain('Transport & Delivery');
    expect(container.textContent).not.toMatch(
      /Overview|Distributor Receipt|Confirm Delivery|Tax Invoice|Download|Assign Transporter/,
    );
    expect(apiClient.get).toHaveBeenCalledWith('/erve-dispatches/ed/transport');
  },
);
it('lists only the restricted discovery endpoint without financial or packing columns', async () => {
  await render('/fulfillment/erve-dispatches');
  expect(container.textContent).toContain('Assigned Dispatches');
  expect(container.textContent).toContain('ED-1');
  expect(container.textContent).not.toMatch(/Distributor|Qty|Download|Dispatch Order/);
  expect(
    vi
      .mocked(apiClient.get)
      .mock.calls.every((call) => call[0] === '/erve-dispatches/assigned-transport'),
  ).toBe(true);
});
it('saves versioned transport details and shows success', async () => {
  vi.spyOn(apiClient, 'patch').mockResolvedValue({
    data: { data: { ...transport, lrNumber: 'LR-9', version: 4 } },
  });
  await render();
  editLr('LR-9');
  await act(async () => button('Save').click());
  await vi.waitFor(() => expect(container.textContent).toContain('Transport information saved'));
  expect(apiClient.patch).toHaveBeenCalledWith(
    '/erve-dispatches/ed/lr',
    expect.objectContaining({ expectedVersion: 3, lrNumber: 'LR-9' }),
  );
});
it('retains typed edits through stale-version recovery and retries with the refreshed version', async () => {
  vi.spyOn(apiClient, 'patch').mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  await render();
  const input = editLr('draft');
  await act(async () => button('Save').click());
  await vi.waitFor(() => expect(button('Refresh Dispatch')).toBeTruthy());
  expect(input.value).toBe('draft');
  expect(button('Save').disabled).toBe(true);
  vi.mocked(apiClient.get).mockResolvedValue({ data: { data: { ...transport, version: 4 } } });
  await act(async () => button('Refresh Dispatch').click());
  await vi.waitFor(() => expect(button('Save').disabled).toBe(false));
  expect(input.value).toBe('draft');
  await act(async () => button('Save').click());
  expect(apiClient.patch).toHaveBeenLastCalledWith(
    '/erve-dispatches/ed/lr',
    expect.objectContaining({ expectedVersion: 4, lrNumber: 'draft' }),
  );
});
it('shows unavailable after revocation, removes editable controls and preserves the draft for ordinary validation errors', async () => {
  vi.spyOn(apiClient, 'patch').mockRejectedValue({ isAxiosError: true, response: { status: 400 } });
  await render();
  const input = editLr('draft');
  await act(async () => button('Save').click());
  await vi.waitFor(() =>
    expect(container.textContent).toContain('Unable to update transport information'),
  );
  expect(input.value).toBe('draft');
  vi.mocked(apiClient.patch).mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  await act(async () => button('Save').click());
  await vi.waitFor(() => expect(container.textContent).toContain('Transport access unavailable'));
  expect(container.querySelector('input')).toBeNull();
});
